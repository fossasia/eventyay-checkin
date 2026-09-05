import { describe, expect, it } from 'vitest'
import {
  computeSyncPercent,
  mergeProgressFloor,
  pageFraction,
  SYNC_PHASES
} from '@/offline/syncProgress'

describe('syncProgress', () => {
  it('weights sum to 100', () => {
    const total = SYNC_PHASES.reduce((sum, phase) => sum + phase.weight, 0)
    expect(total).toBe(100)
  })

  it('advances monotonically across phases', () => {
    const values = SYNC_PHASES.map((phase) => computeSyncPercent(phase.id, 1))
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeGreaterThan(values[i - 1])
    }
    expect(values[values.length - 1]).toBe(100)
  })

  it('keeps orders as the bulk of the progress range', () => {
    const beforeOrders = computeSyncPercent('orders', 0)
    const afterOrders = computeSyncPercent('orders', 1)
    expect(afterOrders - beforeOrders).toBe(62)
    expect(beforeOrders).toBe(18)
  })

  it('uses absolute counts when available', () => {
    expect(pageFraction({ fetched: 50, count: 100, page: 1, hasMore: true })).toBeCloseTo(0.5)
    expect(pageFraction({ fetched: 100, count: 100, page: 2, hasMore: false })).toBe(1)
  })

  it('eases when total count is unknown', () => {
    const p1 = pageFraction({ fetched: 50, page: 1, hasMore: true })
    const p2 = pageFraction({ fetched: 100, page: 2, hasMore: true })
    const done = pageFraction({ fetched: 120, page: 3, hasMore: false })
    expect(p1).toBeCloseTo(0.5)
    expect(p2).toBeGreaterThan(p1)
    expect(done).toBe(1)
  })

  it('never decreases the progress floor', () => {
    expect(mergeProgressFloor(40, 35)).toBe(40)
    expect(mergeProgressFloor(40, 55)).toBe(55)
  })
})
