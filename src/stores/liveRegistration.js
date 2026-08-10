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

    try {
      const createdOrder = await createOrder(attendee, productId)
      const orderCode = createdOrder?.code
      if (!orderCode) {
        throw new Error('Order was created without a valid code.')
      }

      const paidOrder =
        createdOrder?.status === 'p'
          ? createdOrder
          : await markOrderPaid(orderCode)
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
