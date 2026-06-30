import { defineStore } from 'pinia'
import { createAuthorizedDeviceApi } from '@/utils/serverUrl'
import { raiseIfDeviceApiError } from '@/utils/deviceErrors'
import { ref } from 'vue'
import { useEventyayApi } from '@/stores/eventyayapi'

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

  function createApiClient() {
    const processApi = useEventyayApi()
    processApi.refreshServerUrl()
    return createAuthorizedDeviceApi(processApi.url, processApi.apitoken, {
      Accept: 'application/json',
      'Content-Type': 'application/json'
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
      products.value = fetchedProducts.filter((product) => product?.active !== false)
      productsLoaded.value = true
      return products.value
    } catch (err) {
      raiseIfDeviceApiError(err, useEventyayApi())
      throw err
    } finally {
      isLoadingProducts.value = false
    }
  }

  function buildOrderPayload(attendee, productId) {
    const attendeeName = String(attendee.attendee_name || '').trim()
    const attendeeEmail = String(attendee.attendee_email || '').trim()
    const attendeeCompany = String(attendee.company || '').trim()
    const attendeeJobTitle = String(attendee.job_title || '').trim()

    return {
      email: attendeeEmail,
      locale: 'en',
      sales_channel: 'web',
      payment_provider: 'banktransfer',
      invoice_address: {
        ...DEFAULT_INVOICE_ADDRESS,
        company: attendeeCompany,
        name_parts: {
          full_name: attendeeName
        }
      },
      positions: [
        {
          positionid: 1,
          product: Number(productId),
          variation: null,
          attendee_name: attendeeName,
          company: attendeeCompany,
          job_title: attendeeJobTitle,
          attendee_email: attendeeEmail,
          addon_to: null,
          subevent: null
        }
      ]
    }
  }

  async function createOrder(attendee, productId) {
    const { organizer, eventSlug } = getApiContext()
    const api = createApiClient()
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

  async function markOrderPaid(orderCode) {
    const { organizer, eventSlug } = getApiContext()
    const api = createApiClient()
    try {
      return await api.post(
        `/api/v1/organizers/${organizer}/events/${eventSlug}/orders/${orderCode}/mark_paid/`,
        {}
      )
    } catch (err) {
      raiseIfDeviceApiError(err, useEventyayApi())
      throw err
    }
  }

  async function registerAndMarkPaid(attendee, productId) {
    isRegistering.value = true

    try {
      const createdOrder = await createOrder(attendee, productId)
      const orderCode = createdOrder?.code
      if (!orderCode) {
        throw new Error('Order was created without a valid code.')
      }

      const paidOrder = await markOrderPaid(orderCode)
      if (!paidOrder || paidOrder.code !== orderCode || paidOrder.status !== 'p') {
        throw new Error('Order was created, but mark paid did not complete successfully.')
      }

      const orderPosition = paidOrder?.positions?.[0] || createdOrder?.positions?.[0]
      const secret = orderPosition?.secret || ''

      if (!secret) {
        throw new Error('Order marked paid, but ticket secret is missing.')
      }

      return {
        createdOrder,
        paidOrder,
        secret,
        orderCode
      }
    } finally {
      isRegistering.value = false
    }
  }

  return {
    products,
    isLoadingProducts,
    isRegistering,
    fetchProducts,
    registerAndMarkPaid
  }
})
