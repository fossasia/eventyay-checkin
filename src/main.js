import '@/assets/main.css'

import App from '@/App.vue'
import router from '@/router'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { createApp } from 'vue'

import '@/style.css'

// Setup global fetch interceptor to catch 401 session expiry for API calls
const originalFetch = window.fetch
window.fetch = async (...args) => {
  const response = await originalFetch(...args)

  try {
    const [input] = args
    const url =
      input instanceof Request
        ? input.url
        : typeof input === 'string' || input instanceof URL
        ? String(input)
        : null

    const apiBaseUrlProd = import.meta?.env?.VITE_PROD_API_URL
    const apiBaseUrlTest = import.meta?.env?.VITE_TEST_API_URL
    
    const isApiCall =
      url != null &&
      (
        (apiBaseUrlProd && url.startsWith(apiBaseUrlProd)) ||
        (apiBaseUrlTest && url.startsWith(apiBaseUrlTest)) ||
        url.startsWith('/api/') ||
        (url.startsWith(window.location.origin) && url.includes('/api/')) ||
        url.includes('/api/v1/')
      )

    if (isApiCall && response.status === 401) {
      // Remove only our auth/session-related keys to avoid clearing unrelated localStorage data
      localStorage.removeItem('token')
      localStorage.removeItem('eventyayapi')
      
      if (window.location.pathname !== '/') {
        window.location.href = '/'
      }
    }
  } catch {
    // If URL inspection fails for any reason, fall back to returning the response
  }

  return response
}

const app = createApp(App)

const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)

app.use(pinia)
app.use(router)

app.mount('#app')
