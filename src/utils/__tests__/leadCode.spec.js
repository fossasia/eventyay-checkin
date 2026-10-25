import { parseLeadQrPayload, resolveLeadIdentifier } from '@/utils/leadCode'
import { createAuthorizedDeviceApi } from '@/utils/serverUrl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/serverUrl', () => ({
  createAuthorizedDeviceApi: vi.fn(),
  apiV1Path: (path) => `/api/v1/${path}`
}))

const device = {
  url: 'https://tickets.example.test',
  apitoken: 'device-token',
  organizer: 'org',
  eventSlug: 'event'
}
const attendees = [
  { secret: 'ticket-alex', pseudonymization_id: 'LEAD-A', order: 'ORDER-A' },
  { secret: 'ticket-sam', pseudonymization_id: 'LEAD-B', order: 'ORDER-B' }
]
let get
beforeEach(() => {
  vi.clearAllMocks()
  get = vi.fn(async () => ({ results: attendees }))
  createAuthorizedDeviceApi.mockReturnValue({ get })
})

describe('lead identifier resolution', () => {
  it('rejects search results that do not match the scanned ticket secret', async () => {
    expect(await resolveLeadIdentifier(JSON.stringify({ ticket: 'ticket' }), device)).toBeNull()
  })
  it('rejects a partial manually entered identifier instead of choosing the first attendee', async () => {
    expect(await resolveLeadIdentifier('LEAD', device)).toBeNull()
  })
  it('resolves the exact ticket secret even when another attendee appears first', async () => {
    expect(await resolveLeadIdentifier(JSON.stringify({ ticket: 'ticket-sam' }), device)).toBe(
      'LEAD-B'
    )
  })
  it('does not treat ticket secrets as case-insensitive identifiers', async () => {
    expect(await resolveLeadIdentifier('TICKET-SAM', device)).toBeNull()
  })
  it('keeps exact case-insensitive lead and order code matches', async () => {
    expect(await resolveLeadIdentifier('lead-b', device)).toBe('LEAD-B')
    expect(await resolveLeadIdentifier('order-b', device)).toBe('LEAD-B')
  })
  it('uses a lead ID supplied by a badge without an attendee search', async () => {
    expect(await resolveLeadIdentifier(JSON.stringify({ lead: ' LEAD-B ' }), device)).toBe('LEAD-B')
    expect(get).not.toHaveBeenCalled()
  })
  it('returns no identifier when the device cannot search or the API fails', async () => {
    expect(await resolveLeadIdentifier('ticket-sam', {})).toBeNull()
    get.mockRejectedValue(new Error('Offline'))
    expect(await resolveLeadIdentifier('ticket-sam', device)).toBeNull()
  })
  it('retains the raw code and supported badge fields', () => {
    expect(parseLeadQrPayload(' ticket-sam ')).toEqual({
      lead: '',
      ticketSecret: '',
      raw: 'ticket-sam'
    })
    expect(
      parseLeadQrPayload('{"pseudonymization_id":"LEAD-B","secret":"ticket-sam"}')
    ).toMatchObject({
      lead: 'LEAD-B',
      ticketSecret: 'ticket-sam'
    })
  })
})
