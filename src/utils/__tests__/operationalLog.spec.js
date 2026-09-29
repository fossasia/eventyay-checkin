import { logApiResult, logOperational } from '@/utils/operationalLog'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('operationalLog', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes a status line and drops emails, tokens, and urls', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    logOperational({
      action: 'connection.request',
      outcome: 'success',
      status: 200,
      duration_ms: 12,
      backend: 'checkin',
      email: 'person@example.com',
      token: 'secret',
      url: 'https://example.invalid/token'
    })
    expect(info).toHaveBeenCalledTimes(1)
    const line = info.mock.calls[0][1]
    expect(line).toContain('outcome=success')
    expect(line).toContain('status=200')
    expect(line).not.toContain('person@example.com')
    expect(line).not.toContain('secret')
    expect(line).not.toContain('example.invalid')
  })

  it('ignores unsafe action names', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    logOperational({ action: 'bad action', outcome: 'failure', error_code: 'nope value' })
    expect(warn).not.toHaveBeenCalled()
    expect(info).not.toHaveBeenCalled()
  })

  it('logs API failures with a safe error code', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logApiResult({ outcome: 'failure', status: 401, error_code: 'http_error', duration_ms: 8 })
    expect(warn.mock.calls[0][1]).toContain('error_code=http_error')
    expect(warn.mock.calls[0][1]).toContain('status=401')
  })
})
