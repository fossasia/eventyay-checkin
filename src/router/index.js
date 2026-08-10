import EventyayEvents from '@/components/Eventyay/EventyayEvents.vue'
import EventyayLeedLogin from '@/components/Eventyay/EventyayLeedLogin.vue'
import EventyayUnifiedCheckIn from '@/components/Eventyay/EventyayUnifiedCheckIn.vue'
import LeadScanning from '@/components/Eventyay/LeadScanning.vue'
import { useLoadingStore } from '@/stores/loading'
import { useEventyayApi } from '@/stores/eventyayapi'
import NotFound from '@/views/NotFound.vue'
import UserAuth from '@/views/UserAuth.vue'
import { getRoleRouteName, validateDeviceSession } from '@/utils/session'
import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'userAuth',
      component: UserAuth
    },
    {
      path: '/eventyayevents',
      name: 'eventyayevents',
      component: EventyayEvents
    },
    {
      path: '/eventyaycheckin',
      name: 'eventyaycheckin',
      component: EventyayUnifiedCheckIn
    },
    {
      path: '/eventyaysearchcheckin',
      name: 'eventyaysearchcheckin',
      redirect: { name: 'eventyaycheckin' }
    },
    {
      path: '/eventyayleedlogin',
      name: 'eventyayleedlogin',
      component: EventyayLeedLogin
    },
    {
      path: '/leadscan',
      name: 'leadscan',
      component: LeadScanning
    },
    { path: '/:pathMatch(.*)*', name: 'NotFound', component: NotFound }
  ]
})

const publicPages = new Set(['userAuth', 'NotFound'])
const eventRequiredPages = new Set(['eventyaycheckin', 'eventyayleedlogin', 'leadscan'])

router.beforeEach(async (to, from, next) => {
  const loadingStore = useLoadingStore()
  loadingStore.contentLoading()

  const processApi = useEventyayApi()
  processApi.refreshServerUrl()

  if (publicPages.has(to.name)) {
    if (to.name === 'userAuth' && processApi.apitoken && processApi.selectedRole) {
      const isValid = await validateDeviceSession(processApi)
      if (!isValid) {
        processApi.logout({ clearRole: false, redirect: false })
        next({ name: 'userAuth' })
        return
      }

      if (processApi.eventSlug && getRoleRouteName(processApi.selectedRole) === 'eventyaycheckin') {
        next({ name: 'eventyaycheckin' })
        return
      }

      if (processApi.eventSlug && processApi.selectedRole === 'Exhibitor') {
        next({ name: 'eventyayleedlogin' })
        return
      }

      next({ name: 'eventyayevents' })
      return
    }

    next()
    return
  }

  if (!processApi.apitoken) {
    next({ name: 'userAuth' })
    return
  }

  if (!processApi.selectedRole) {
    next({ name: 'userAuth' })
    return
  }

  const isValid = await validateDeviceSession(processApi)
  if (!isValid) {
    processApi.logout({ clearRole: false, redirect: false })
    next({ name: 'userAuth' })
    return
  }

  if (eventRequiredPages.has(to.name) && !processApi.eventSlug) {
    next({ name: 'eventyayevents' })
    return
  }

  if (to.name === 'leadscan' && !processApi.exikey?.trim()) {
    next({ name: 'eventyayleedlogin' })
    return
  }

  next()
})

router.afterEach(() => {
  const loadingStore = useLoadingStore()
  loadingStore.contentLoaded()
  loadingStore.navbarLoaded()
})

export default router
