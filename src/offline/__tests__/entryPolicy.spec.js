import { createMemoryIndex } from '@/offline/memoryIndex'
import { evaluateLocalRedeem } from '@/offline/offlineActions'
import { describe, expect, it } from 'vitest'

function indexWithHistory(checkins, settings = {}) {
  return createMemoryIndex({
    positionsBySecret: {
      ticket: { secret: 'ticket', orderStatus: 'p', checkins }
    },
    checkInLists: [{ id: 3, ...settings }]
  })
}

const entry = { list: 3, type: 'entry', datetime: '2030-01-01T09:00:00Z' }
const exit = { list: 3, type: 'exit', datetime: '2030-01-01T10:00:00Z' }

describe('offline check-in list entry settings', () => {
  it('allows another entry when the list permits multiple entries', () => {
    const index = indexWithHistory([entry], { allow_multiple_entries: true })
    expect(evaluateLocalRedeem(index, 'ticket', { listId: 3 }).alreadyRedeemed).toBe(false)
  })

  it('allows re-entry after a later exit when the list permits it', () => {
    const index = indexWithHistory([entry, exit], { allow_entry_after_exit: true })
    expect(evaluateLocalRedeem(index, 'ticket', { listId: '3' }).alreadyRedeemed).toBe(false)
  })

  it('uses timestamps rather than response order to find the latest scan', () => {
    const index = indexWithHistory([exit, entry], { allow_entry_after_exit: true })
    expect(evaluateLocalRedeem(index, 'ticket', { listId: 3 }).alreadyRedeemed).toBe(false)
  })

  it('does not treat an exit on another list as permission to re-enter', () => {
    const index = indexWithHistory([entry, { ...exit, list: 4 }], {
      allow_entry_after_exit: true
    })
    expect(evaluateLocalRedeem(index, 'ticket', { listId: 3 }).alreadyRedeemed).toBe(true)
  })

  it('blocks a second entry after re-entering a single-entry list', () => {
    const index = indexWithHistory([entry, exit, { ...entry, datetime: '2030-01-01T11:00:00Z' }], {
      allow_entry_after_exit: true
    })
    expect(evaluateLocalRedeem(index, 'ticket', { listId: 3 }).alreadyRedeemed).toBe(true)
  })

  it('retains duplicate protection when re-entry is disabled or settings are absent', () => {
    const index = indexWithHistory([entry, exit])
    expect(evaluateLocalRedeem(index, 'ticket', { listId: 3 }).alreadyRedeemed).toBe(true)
    index.checkInLists = []
    expect(evaluateLocalRedeem(index, 'ticket', { listId: 3 }).alreadyRedeemed).toBe(true)
  })

  it('does not apply another list’s multiple-entry setting', () => {
    const index = indexWithHistory([entry])
    index.checkInLists.push({ id: 4, allow_multiple_entries: true })
    expect(evaluateLocalRedeem(index, 'ticket', { listId: 3 }).alreadyRedeemed).toBe(true)
  })

  it('still permits first entries and exits', () => {
    expect(evaluateLocalRedeem(indexWithHistory([]), 'ticket', { listId: 3 }).alreadyRedeemed).toBe(
      false
    )
    expect(
      evaluateLocalRedeem(indexWithHistory([entry]), 'ticket', {
        listId: 3,
        type: 'exit'
      }).alreadyRedeemed
    ).toBe(false)
  })

  it.each([
    { limit_one_checkin_per_day: true },
    { limit_one_checkin_per_gate: true },
    { rules: { '==': [{ var: 'entries' }, 0] } }
  ])('retains duplicate protection for restricted lists: %j', (restriction) => {
    const index = indexWithHistory([entry, exit], {
      allow_multiple_entries: true,
      allow_entry_after_exit: true,
      ...restriction
    })
    expect(evaluateLocalRedeem(index, 'ticket', { listId: 3 }).alreadyRedeemed).toBe(true)
  })

  it('does not infer an exit is later when a history timestamp is missing', () => {
    const index = indexWithHistory([{ ...entry, datetime: null }, exit], {
      allow_entry_after_exit: true
    })
    expect(evaluateLocalRedeem(index, 'ticket', { listId: 3 }).alreadyRedeemed).toBe(true)
  })

  it('still rejects unpaid and revoked tickets on a multiple-entry list', () => {
    const index = indexWithHistory([entry], { allow_multiple_entries: true })
    index.positionsBySecret.get('ticket').orderStatus = 'e'
    expect(evaluateLocalRedeem(index, 'ticket', { listId: 3 }).reason).toBe('unpaid')
    index.revokedSecrets.add('ticket')
    expect(evaluateLocalRedeem(index, 'ticket', { listId: 3 }).reason).toBe('revoked')
  })
})
