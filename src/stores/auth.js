import { useApiStore } from '@/stores/api'
import clearStores from '@/utils/clearStores'
import { createOperationalId, logOperational } from '@/utils/operationalLog'
import { defineStore } from 'pinia'

export const useAuthStore = defineStore('auth', () => {
  const apiStore = useApiStore()

  async function logout(options = {}) {
    const started = Date.now()
    const requestId = createOperationalId('auth')
    const correlationId = options?.correlationId ?? null
    try {
      const res = await apiStore.post(false, 'auth/logout', false, false, { correlationId: requestId })
      useApiStore().clearToken()
      localStorage.clear()
      // clear all stores as well
      clearStores()
      logOperational({
        action: 'auth.logout',
        outcome: 'success',
        duration_ms: Date.now() - started,
        request_id: requestId,
        correlation_id: correlationId
      })
      return res.success
    } catch (error) {
      logOperational({
        action: 'auth.logout',
        outcome: 'failure',
        status: error?.response?.status ?? null,
        duration_ms: Date.now() - started,
        request_id: requestId,
        correlation_id: correlationId,
        error_code: 'logout_failed'
      })
      return Promise.reject(error)
    }
  }

  async function login(payload, options = {}) {
    const started = Date.now()
    const requestId = createOperationalId('auth')
    const correlationId = options?.correlationId ?? null
    try {
      const res = await apiStore.post(true, 'auth/login', payload, false, { correlationId: requestId })
      localStorage.setItem('token', res.access_token)
      logOperational({
        action: 'auth.login',
        outcome: 'success',
        duration_ms: Date.now() - started,
        request_id: requestId,
        correlation_id: correlationId
      })
      return true
    } catch (error) {
      const status = error?.response?.status ?? null
      logOperational({
        action: 'auth.login',
        outcome: 'failure',
        status,
        duration_ms: Date.now() - started,
        request_id: requestId,
        correlation_id: correlationId,
        error_code: status === 401 || status === 403 ? 'invalid_credentials' : 'login_failed'
      })
      return Promise.reject(error)
    }
  }

  async function verifyPassword(payload, options = {}) {
    const started = Date.now()
    const requestId = createOperationalId('auth')
    const correlationId = options?.correlationId ?? null
    try {
      const res = await apiStore.post(true, 'auth/verify-password', payload, false, { correlationId: requestId })
      logOperational({
        action: 'auth.verify_password',
        outcome: res.result ? 'success' : 'failure',
        duration_ms: Date.now() - started,
        request_id: requestId,
        correlation_id: correlationId,
        error_code: res.result ? undefined : 'invalid_credentials'
      })
      return res.result
    } catch (error) {
      logOperational({
        action: 'auth.verify_password',
        outcome: 'failure',
        status: error?.response?.status ?? null,
        duration_ms: Date.now() - started,
        request_id: requestId,
        correlation_id: correlationId,
        error_code: 'verification_failed'
      })
      return Promise.reject(error)
    }
  }

  return { logout, login, verifyPassword }
})
