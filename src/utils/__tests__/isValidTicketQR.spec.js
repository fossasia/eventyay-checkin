import { describe, expect, it } from 'vitest'
import isValidTicketQR from '../isValidTicketQR'

describe('isValidTicketQR', () => {
  it('returns false for empty values', () => {
    expect(isValidTicketQR('')).toBe(false)
    expect(isValidTicketQR(null)).toBe(false)
  })

  it('returns true for non-empty values matching the UUID format', () => {
    expect(isValidTicketQR('12345678-1234-1234-1234-1234567890ab-1')).toBe(true)
  })
})
