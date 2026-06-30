import { useCameraStore } from '@/stores/camera'
import { useEventyayApi } from '@/stores/eventyayapi'
import { resolveLeadIdentifier } from '@/utils/leadCode'
import { createAuthorizedExhibitorApi, exhibitorApiPath } from '@/utils/serverUrl'
import { getDeviceErrorMessage, handleDeviceApiError } from '@/utils/deviceErrors'
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useLeadScanStore = defineStore('processLeadScan', () => {
  const cameraStore = useCameraStore()
  const message = ref('')
  const showSuccess = ref(false)
  const showError = ref(false)
  const currentLeadId = ref('')

  function $reset() {
    message.value = ''
    showSuccess.value = false
    showError.value = false
  }

  function showErrorMsg(msg) {
    message.value = msg
    showSuccess.value = false
    showError.value = true
  }

  function showSuccessMsg(msg) {
    message.value = msg
    showSuccess.value = true
    showError.value = false
  }

  async function scanLeadByCode(code) {
    const processApi = useEventyayApi()
    processApi.refreshServerUrl()

    const url = processApi.url
    const apitoken = processApi.apitoken
    const organizer = processApi.organizer
    const eventSlug = processApi.eventSlug
    const exikey = processApi.exikey

    if (!url || !apitoken || !organizer || !eventSlug || !exikey) {
      showErrorMsg({
        message: 'Device or exhibitor session is not configured.',
        attendee: null
      })
      return
    }

    const leadValue = await resolveLeadIdentifier(code, processApi)
    if (!leadValue) {
      showErrorMsg({
        message: 'No lead code found. Scan a badge QR or enter a lead code.',
        attendee: null
      })
      return
    }

    const requestBody = {
      lead: leadValue,
      scanned: 'null',
      scan_type: 'lead',
      device_name: 'Test',
      open_event: false
    }

    try {
      const api = createAuthorizedExhibitorApi(url, apitoken, exikey)
      const response = await api.post(exhibitorApiPath(organizer, eventSlug, 'lead/create'), requestBody)
      if (response.success) {
        showSuccessMsg({
          message: 'Lead Scanned Successfully!',
          attendee: response.attendee
        })
        currentLeadId.value = leadValue
      }
    } catch (err) {
      if (
        handleDeviceApiError(err, processApi, {
          onProfileDenied: (msg) =>
            showErrorMsg({
              message: msg,
              attendee: null
            })
        })
      ) {
        return
      }

      if (err.response && err.response.status === 409) {
        showErrorMsg({
          message: err.body?.error || 'Lead Already Scanned!',
          attendee: err.body?.attendee
        })
        currentLeadId.value = leadValue
      } else {
        showErrorMsg({
          message: getDeviceErrorMessage(err, 'Lead scan failed.'),
          attendee: null
        })
      }
    }
  }

  async function scanLead() {
    await scanLeadByCode(cameraStore.qrCodeValue)
  }

  function downloadCSV(leads) {
    const csvData = convertToCSV(leads)
    const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' })
    const blobUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', blobUrl)
    link.setAttribute('download', `leads-${new Date().toISOString().split('T')[0]}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(blobUrl)
  }

  function convertToCSV(leads) {
    const formatDate = (date) => new Date(date).toISOString().split('T')[0]
    const formatTime = (date) => new Date(date).toISOString().split('T')[1].split('.')[0]
    const headers = [
      'ID',
      'Exhibitor',
      'Pseudonymization ID',
      'Scanned Date',
      'Scan Time',
      'Scan Type',
      'Device Name',
      'Booth ID',
      'Booth Name',
      'Attendee Name',
      'Email',
      'Company',
      'Note',
      'Tags'
    ]

    const rows = leads.map((lead) => [
      lead.id,
      lead.exhibitor_name,
      lead.pseudonymization_id,
      formatDate(lead.scanned),
      formatTime(lead.scanned),
      lead.scan_type,
      lead.device_name,
      lead.booth_id,
      lead.booth_name,
      lead.attendee.name,
      lead.attendee.email || '',
      lead.attendee.company || '',
      lead.attendee.note || '',
      lead.attendee.tags.join('; ')
    ])

    const csvContent = [
      headers.join(','),
      ...rows.map((row) =>
        row
          .map((cell) => {
            const cellContent = String(cell).replace(/"/g, '""')
            return cellContent.includes(',') ? `"${cellContent}"` : cellContent
          })
          .join(',')
      )
    ].join('\n')

    return '\uFEFF' + csvContent
  }

  async function exportLeads() {
    const processApi = useEventyayApi()
    processApi.refreshServerUrl()

    const url = processApi.url
    const apitoken = processApi.apitoken
    const organizer = processApi.organizer
    const eventSlug = processApi.eventSlug
    const exikey = processApi.exikey

    if (!url || !apitoken || !organizer || !eventSlug || !exikey) {
      return
    }

    try {
      const api = createAuthorizedExhibitorApi(url, apitoken, exikey)
      const response = await api.get(exhibitorApiPath(organizer, eventSlug, 'lead/retrieve'))
      if (response.success) {
        downloadCSV(response.leads)
      }
    } catch (error) {
      console.error('Failed to export leads:', error)
      handleDeviceApiError(error, processApi, {
        onProfileDenied: (msg) =>
          showErrorMsg({
            message: msg,
            attendee: null
          })
      })
    }
  }

  return {
    message,
    showSuccess,
    showError,
    currentLeadId,
    scanLead,
    scanLeadByCode,
    exportLeads,
    $reset
  }
})
