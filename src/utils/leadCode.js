import { createAuthorizedDeviceApi, apiV1Path } from '@/utils/serverUrl'

export function parseLeadQrPayload(rawValue) {
  const trimmed = String(rawValue || '').trim()
  if (!trimmed) {
    return { lead: '', ticketSecret: '', raw: '' }
  }

  try {
    const parsed = JSON.parse(trimmed)
    return {
      lead: String(parsed.lead || parsed.pseudonymization_id || '').trim(),
      ticketSecret: String(parsed.ticket || parsed.secret || '').trim(),
      raw: trimmed
    }
  } catch {
    return { lead: '', ticketSecret: '', raw: trimmed }
  }
}

function pickLeadMatch(results, searchTerm) {
  const normalized = String(searchTerm || '').trim()
  if (!normalized) {
    return null
  }

  const lower = normalized.toLowerCase()
  return (
    results.find((position) => String(position.secret || '').trim() === normalized) ||
    results.find((position) => String(position.pseudonymization_id || '').toLowerCase() === lower) ||
    results.find((position) => String(position.order || '').toLowerCase() === lower) ||
    results[0] ||
    null
  )
}

export async function resolveLeadIdentifier(code, processApi) {
  const { lead, ticketSecret, raw } = parseLeadQrPayload(code)
  if (lead) {
    return lead
  }

  const searchTerm = ticketSecret || raw
  if (!searchTerm) {
    return null
  }
  if (!processApi?.organizer || !processApi?.eventSlug || !processApi?.url || !processApi?.apitoken) {
    return null
  }

  try {
    const api = createAuthorizedDeviceApi(processApi.url, processApi.apitoken)
    const params = new URLSearchParams({
      search: searchTerm,
      page_size: '10'
    })
    const response = await api.get(
      apiV1Path(
        `organizers/${processApi.organizer}/events/${processApi.eventSlug}/orderpositions/?${params.toString()}`
      )
    )
    const results = response?.results || []
    const match = pickLeadMatch(results, searchTerm)
    return match?.pseudonymization_id || null
  } catch {
    return null
  }
}
