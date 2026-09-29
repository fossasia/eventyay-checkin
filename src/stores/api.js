import { logApiResult } from '@/utils/operationalLog'
import { defaults, mande } from 'mande'
import { defineStore } from 'pinia'

export const useApiStore = defineStore('api', () => {
  const apiUrl =
    import.meta.env.MODE === 'production'
      ? (import.meta.env.VITE_PROD_API_URL || '')
      : (import.meta.env.VITE_TEST_API_URL || '')

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

  async function get(requiresAuth, path, payload) {
    newSession(requiresAuth)
    instance.options.headers['Accept'] = 'application/vnd.api+json'
    const started = Date.now()
    try {
      let response
      if (payload) {
        response = await instance.get(path)
      } else {
        response = await instance.get(path, payload)
      }
      logApiResult({ outcome: 'success', duration_ms: Date.now() - started })
      return response
    } catch (error) {
      logApiResult({
        outcome: 'failure',
        status: error?.response?.status,
        duration_ms: Date.now() - started,
        error_code: 'http_error'
      })
      return Promise.reject(error)
    }
  }

  async function post(requiresAuth, path, payload = false, hasBody = false) {
    newSession(requiresAuth)
    const started = Date.now()
    try {
      let response
      if (hasBody) {
        delete defaults.headers['Content-Type']
        const options = instance.options
        options['body'] = payload
        response = await instance.post(path)
      } else {
        if (payload) {
          instance.options.headers['Accept'] = 'application/vnd.api+json'
          instance.options.headers['Content-Type'] = 'application/vnd.api+json'
          response = await instance.post(path, payload)
        } else {
          response = await instance.post(path)
        }
      }
      logApiResult({ outcome: 'success', duration_ms: Date.now() - started })
      return response
    } catch (error) {
      logApiResult({
        outcome: 'failure',
        status: error?.response?.status,
        duration_ms: Date.now() - started,
        error_code: 'http_error'
      })
      return Promise.reject(error)
    }
  }

  return { instance, setToken, clearToken, newSession, get, post }
})
