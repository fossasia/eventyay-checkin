import '@/assets/main.css'

import App from '@/App.vue'
import router from '@/router'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { createApp } from 'vue'

import '@/style.css'

import i18n from '@/i18n'
import { logOperational } from '@/utils/operationalLog'

const app = createApp(App)

app.config.errorHandler = (err) => {
  const errorCode = err?.name || 'unhandled_error'
  console.error('Unhandled application error:', errorCode)
  logOperational({
    action: 'app.error',
    outcome: 'failure',
    error_code: errorCode
  })
}

const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)

app.use(pinia)
app.use(i18n)
app.use(router)

app.mount('#app')

logOperational({
  action: 'app.start',
  outcome: 'success'
})
