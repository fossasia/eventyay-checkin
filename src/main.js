import '@/assets/main.css'

import App from '@/App.vue'
import router from '@/router'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { createApp } from 'vue'

import '@/style.css'

// Setup global fetch interceptor to catch 401 session expiry
const originalFetch = window.fetch
window.fetch = async (...args) => {
  const response = await originalFetch(...args)
  if (response.status === 401) {
    localStorage.clear()
    if (window.location.pathname !== '/') {
      window.location.href = '/'
    }
  }
  return response
}

const app = createApp(App)

const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)

app.use(pinia)
app.use(router)

app.mount('#app')
