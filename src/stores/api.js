import { createOperationalId, logApiResult } from '@/utils/operationalLog'
import { defaults, mande } from 'mande'
import { defineStore } from 'pinia'

export const useApiStore = defineStore('api', () => {
  const apiUrl =
    import.meta.env.MODE === 'production'
      ? import.meta.env.VITE_PROD_API_URL || ''
      : import.meta.env.VITE_TEST_API_URL || ''

  let instance = mande(apiUrl)

  function setToken() {
    const token = localStorage.getItem('token')
    instance.options.headers.Authorization = 'JWT ' + token
  }

  function clearToken() {
    instance.options.headers.Authorization = ''
  }

  function newSession(authenticated) {
    // reinit
    instance = mande(apiUrl)
    if (authenticated) {
      setToken()
    } else {
      clearToken()
    }
  }

  async function parseTransportResponse(rawResponse) {
    if (typeof rawResponse?.json === 'function' && typeof rawResponse?.status === 'number') {
      const status = rawResponse.status
      const body = status === 204 ? null : await rawResponse.json().catch(() => null)
      return { status, body }
    }
    return { status: 200, body: rawResponse }
  }

  async function get(requiresAuth, path, payload) {
    newSession(requiresAuth)
    instance.options.headers['Accept'] = 'application/vnd.api+json'
    const started = Date.now()
    const requestId = createOperationalId('req')
    try {
      let rawResponse
      if (payload) {
        rawResponse = await instance.get(path, { responseAs: 'response' })
      } else {
        rawResponse = await instance.get(path, { ...payload, responseAs: 'response' })
      }
      const { status, body } = await parseTransportResponse(rawResponse)
      logApiResult({
        outcome: 'success',
        status,
        duration_ms: Date.now() - started,
        request_id: requestId
      })
      return body
    } catch (error) {
      logApiResult({
        outcome: 'failure',
        status: error?.response?.status ?? null,
        duration_ms: Date.now() - started,
        error_code: 'http_error',
        request_id: requestId
      })
      return Promise.reject(error)
    }
  }

  async function post(requiresAuth, path, payload = false, hasBody = false) {
    newSession(requiresAuth)
    const started = Date.now()
    const requestId = createOperationalId('req')
    try {
      let rawResponse
      if (hasBody) {
        delete defaults.headers['Content-Type']
        const options = instance.options
        options['body'] = payload
        rawResponse = await instance.post(path, null, { responseAs: 'response' })
      } else {
        if (payload) {
          instance.options.headers['Accept'] = 'application/vnd.api+json'
          instance.options.headers['Content-Type'] = 'application/vnd.api+json'
          rawResponse = await instance.post(path, payload, { responseAs: 'response' })
        } else {
          rawResponse = await instance.post(path, null, { responseAs: 'response' })
        }
      }
      const { status, body } = await parseTransportResponse(rawResponse)
      logApiResult({
        outcome: 'success',
        status,
        duration_ms: Date.now() - started,
        request_id: requestId
      })
      return body
    } catch (error) {
      logApiResult({
        outcome: 'failure',
        status: error?.response?.status ?? null,
        duration_ms: Date.now() - started,
        error_code: 'http_error',
        request_id: requestId
      })
      return Promise.reject(error)
    }
  }

  return { instance, setToken, clearToken, newSession, get, post }
})
