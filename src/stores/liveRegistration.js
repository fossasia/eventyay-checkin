import { defineStore } from 'pinia'
import { createAuthorizedDeviceApi } from '@/utils/serverUrl'
import {
  isDeviceAuthFailure,
  isDeviceProfileDenied,
  raiseIfDeviceApiError
} from '@/utils/deviceErrors'
import { createOperationalId, logApiResult, logOperational } from '@/utils/operationalLog'
import { ref } from 'vue'
import { useEventyayApi } from '@/stores/eventyayapi'
import { useOfflineSyncStore } from '@/stores/offlineSync'
import { enqueuePendingRegistration, isBrowserOffline } from '@/offline/offlineActions'
import { canUseOfflineSync, persistOfflineIndex } from '@/offline/syncEngine'

const DEFAULT_INVOICE_ADDRESS = {
  is_business: false,
  street: 'N/A',
  zipcode: '00000',
  city: 'N/A',
  country: 'US',
  state: '',
  internal_reference: '',
  vat_id: ''
}

export const useLiveRegistrationStore = defineStore('liveRegistration', () => {
  const products = ref([])
  const isLoadingProducts = ref(false)
  const isRegistering = ref(false)
  const productsLoaded = ref(false)

  function createApiClient(extraHeaders = {}) {
    const processApi = useEventyayApi()
    processApi.refreshServerUrl()
    return createAuthorizedDeviceApi(processApi.url, processApi.apitoken, {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...extraHeaders
    })
  }

  function getApiContext() {
    const processApi = useEventyayApi()
    return { organizer: processApi.organizer, eventSlug: processApi.eventSlug }
  }

  async function fetchProducts({ force = false } = {}) {
    if (productsLoaded.value && !force) {
      return products.value
    }

    isLoadingProducts.value = true

    try {
      const { organizer, eventSlug } = getApiContext()
      const api = createApiClient()
      const response = await api.get(
        `/api/v1/organizers/${organizer}/events/${eventSlug}/products/`
      )

      const fetchedProducts = Array.isArray(response?.results) ? response.results : []
      products.value = fetchedProducts.filter(
        (product) => product?.active !== false && product?.admission !== false
      )
      productsLoaded.value = true
      return products.value
    } catch (err) {
      raiseIfDeviceApiError(err, useEventyayApi())
      throw err
    } finally {
      isLoadingProducts.value = false
    }
  }

  function restoreProductsFromSnapshot(snapshotProducts) {
    if (!Array.isArray(snapshotProducts) || !snapshotProducts.length) {
      return
    }
    products.value = snapshotProducts
    productsLoaded.value = true
  }

  function buildOrderPayload(attendee, productId) {
    const attendeeName = String(attendee.attendee_name || '').trim()
    const attendeeEmail = String(attendee.attendee_email || '').trim()
    const attendeeCompany = String(attendee.company || '').trim()
    const attendeeJobTitle = String(attendee.job_title || '').trim()
    const product = products.value.find((entry) => String(entry.id) === String(productId))
    const variationId =
      product?.has_variations && product?.variations?.length
        ? Number(product.variations[0].id)
        : null

    if (product?.has_variations && !variationId) {
      throw new Error('Selected product requires a variation, but none are available.')
    }

    return {
      email: attendeeEmail,
      locale: 'en',
      sales_channel: 'web',
      payment_provider: 'manual',
      send_email: false,
      invoice_address: {
        ...DEFAULT_INVOICE_ADDRESS,
        company: attendeeCompany,
        name_parts: {
          full_name: attendeeName,
        },
      },
      positions: [
        {
          positionid: 1,
          product: Number(productId),
          variation: variationId,
          attendee_name_parts: {
            full_name: attendeeName,
          },
          company: attendeeCompany,
          job_title: attendeeJobTitle,
          attendee_email: attendeeEmail,
          addon_to: null,
          subevent: null,
        },
      ],
    }
  }

  async function createOrder(attendee, productId, { correlationId = null } = {}) {
    const { organizer, eventSlug } = getApiContext()
    const extraHeaders = correlationId ? { 'X-Correlation-Id': correlationId } : {}
    const api = createApiClient(extraHeaders)
    try {
      return await api.post(
        `/api/v1/organizers/${organizer}/events/${eventSlug}/orders/`,
        buildOrderPayload(attendee, productId)
      )
    } catch (err) {
      raiseIfDeviceApiError(err, useEventyayApi())
      throw err
    }
  }

  async function markOrderPaid(orderCode, { correlationId = null } = {}) {
    const { organizer, eventSlug } = getApiContext()
    const extraHeaders = correlationId ? { 'X-Correlation-Id': correlationId } : {}
    const api = createApiClient(extraHeaders)
    try {
      return await api.post(
        `/api/v1/organizers/${organizer}/events/${eventSlug}/orders/${orderCode}/mark_paid/`,
        { send_email: false }
      )
    } catch (err) {
      raiseIfDeviceApiError(err, useEventyayApi())
      throw err
    }
  }

  function pickTicketDownloadUrl(orderPosition) {
    return (orderPosition?.downloads || []).find((entry) => entry.output === 'pdf')?.url || ''
  }

  function resolveTicketDownload(orderPosition) {
    const positionId = orderPosition?.id || null
    const ticketDownloadUrl = pickTicketDownloadUrl(orderPosition)

    return {
      orderPosition,
      orderPositionId: positionId,
      ticketDownloadUrl,
      ticketDownloadAvailable: Boolean(ticketDownloadUrl)
    }
  }

  async function registerAndMarkPaid(attendee, productId) {
    isRegistering.value = true
    const started = Date.now()
    const requestId = createOperationalId('reg')
    const processApi = useEventyayApi()
    const isOffline =
      isBrowserOffline() &&
      canUseOfflineSync(processApi.selectedRole, processApi.securityProfile)
    const action = isOffline ? 'checkin.live_register_offline' : 'checkin.live_register'
    let persistenceStarted = false

    try {
      if (isOffline) {
        const offlineSync = useOfflineSyncStore()
        if (!offlineSync.index) {
          await offlineSync.hydrate(processApi)
        }
        const payload = buildOrderPayload(attendee, productId)
        const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        enqueuePendingRegistration(offlineSync.index, {
          id: pendingId,
          payload,
          createdAt: new Date().toISOString()
        })
        persistenceStarted = true
        await persistOfflineIndex(offlineSync.index, { apitoken: processApi.apitoken })
        logOperational({
          action,
          outcome: 'success',
          duration_ms: Date.now() - started,
          request_id: requestId
        })
        return {
          createdOrder: null,
          paidOrder: null,
          secret: '',
          orderCode: '',
          orderPosition: null,
          orderPositionId: null,
          ticketDownloadUrl: '',
          ticketDownloadAvailable: false,
          offlinePending: true,
          pendingId
        }
      }

      const createdOrder = await createOrder(attendee, productId, { correlationId: requestId })
      const orderCode = createdOrder?.code
      if (!orderCode) {
        throw new Error('Order was created without a valid code.')
      }

      const paidOrder =
        createdOrder?.status === 'p'
          ? createdOrder
          : await markOrderPaid(orderCode, { correlationId: requestId })
      if (!paidOrder || paidOrder.code !== orderCode || paidOrder.status !== 'p') {
        throw new Error('Order was created, but mark paid did not complete successfully.')
      }

      const orderPosition = paidOrder?.positions?.[0] || createdOrder?.positions?.[0]
      const secret = orderPosition?.secret || ''

      if (!secret) {
        throw new Error('Order marked paid, but ticket secret is missing.')
      }

      const {
        orderPosition: resolvedPosition,
        orderPositionId,
        ticketDownloadUrl,
        ticketDownloadAvailable
      } = resolveTicketDownload(orderPosition)

      logApiResult({
        action,
        outcome: 'success',
        duration_ms: Date.now() - started,
        request_id: requestId,
        correlation_id: requestId
      })

      return {
        createdOrder,
        paidOrder,
        secret,
        orderCode,
        orderPosition: resolvedPosition,
        orderPositionId,
        ticketDownloadUrl,
        ticketDownloadAvailable
      }
    } catch (error) {
      logApiResult({
        action,
        outcome: 'failure',
        status: error?.response?.status ?? error?.status ?? null,
        duration_ms: Date.now() - started,
        request_id: requestId,
        correlation_id: requestId,
        error_code: isDeviceProfileDenied(error)
          ? 'device_profile_denied'
          : isDeviceAuthFailure(error)
            ? 'device_auth_failed'
            : isOffline && persistenceStarted
              ? 'offline_persist_failed'
              : 'registration_failed'
      })
      throw error
    } finally {
      isRegistering.value = false
    }
  }

  return {
    products,
    isLoadingProducts,
    isRegistering,
    productsLoaded,
    fetchProducts,
    restoreProductsFromSnapshot,
    registerAndMarkPaid
  }
})
