import { useApiStore } from '@/stores/api'
import clearStores from '@/utils/clearStores'
import { logOperational } from '@/utils/operationalLog'
import { defineStore } from 'pinia'

export const useAuthStore = defineStore('auth', () => {
  const apiStore = useApiStore()

  async function logout() {
    try {
      const res = await apiStore.post(false, 'auth/logout')
      useApiStore().clearToken()
      localStorage.clear()
      // clear all stores as well
      clearStores()
      logOperational({ action: 'auth.logout', outcome: 'success' })
      return res.success
    } catch (error) {
      logOperational({
        action: 'auth.logout',
        outcome: 'failure',
        status: error?.response?.status ?? null,
        error_code: 'logout_failed'
      })
      return Promise.reject(error)
    }
  }

  async function login(payload) {
    try {
      const res = await apiStore.post(true, 'auth/login', payload)
      localStorage.setItem('token', res.access_token)
      logOperational({ action: 'auth.login', outcome: 'success' })
      return true
    } catch (error) {
      const status = error?.response?.status ?? null
      logOperational({
        action: 'auth.login',
        outcome: 'failure',
        status,
        error_code: status === 401 || status === 403 ? 'invalid_credentials' : 'login_failed'
      })
      return Promise.reject(error)
    }
  }

  async function verifyPassword(payload) {
    try {
      const res = await apiStore.post(true, 'auth/verify-password', payload)
      logOperational({
        action: 'auth.verify_password',
        outcome: res.result ? 'success' : 'failure',
        error_code: res.result ? undefined : 'invalid_credentials'
      })
      return res.result
    } catch (error) {
      logOperational({
        action: 'auth.verify_password',
        outcome: 'failure',
        status: error?.response?.status ?? null,
        error_code: 'verification_failed'
      })
      return Promise.reject(error)
    }
  }

  return { logout, login, verifyPassword }
})
