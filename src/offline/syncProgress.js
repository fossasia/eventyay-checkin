/**
 * Weighted sync phases. Orders dominate because they are the bulk of the work.
 * Weights sum to 100 so the displayed percent maps 1:1 to completed weight.
 */
export const SYNC_PHASES = [
  { id: 'layouts', weight: 6, label: 'Layouts' },
  { id: 'products', weight: 6, label: 'Products' },
  { id: 'checkinlists', weight: 6, label: 'Lists' },
  { id: 'orders', weight: 62, label: 'Orders' },
  { id: 'revoked', weight: 6, label: 'Revoked' },
  { id: 'flush', weight: 8, label: 'Uploading' },
  { id: 'persist', weight: 6, label: 'Saving' }
]

export function clamp01(value) {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.min(1, Math.max(0, value))
}

export function phaseIndex(phaseId) {
  return SYNC_PHASES.findIndex((phase) => phase.id === phaseId)
}

export function phaseLabel(phaseId) {
  return SYNC_PHASES.find((phase) => phase.id === phaseId)?.label || 'Syncing'
}

/**
 * Convert a phase + in-phase fraction (0..1) into an overall 0..100 percent.
 * When totalCount is known for a paginated phase, pass fraction = fetched / totalCount.
 */
export function computeSyncPercent(phaseId, fractionWithinPhase = 0) {
  const index = phaseIndex(phaseId)
  if (index < 0) {
    return 0
  }

  let completedWeight = 0
  for (let i = 0; i < index; i += 1) {
    completedWeight += SYNC_PHASES[i].weight
  }

  const phase = SYNC_PHASES[index]
  const within = phase.weight * clamp01(fractionWithinPhase)
  return Math.min(100, Math.round(completedWeight + within))
}

/**
 * Estimate in-phase fraction from pagination metadata.
 * Prefer absolute count when the API provides it; otherwise ease toward completion
 * as pages arrive so the bar does not jump from 0 → 100 when the last page lands.
 */
export function pageFraction({ fetched = 0, count = null, page = 1, hasMore = false } = {}) {
  if (typeof count === 'number' && count > 0) {
    const ratio = fetched / count
    // Leave a tiny tail until the last page finishes so "100%" within the phase
    // only happens when hasMore is false.
    if (hasMore) {
      return clamp01(Math.min(ratio, 0.97))
    }
    return clamp01(Math.max(ratio, 1))
  }

  if (!hasMore) {
    return 1
  }

  // Unknown total: asymptotic climb (page 1 ≈ 50%, page 2 ≈ 67%, …) so growth stays smooth.
  return clamp01(1 - 1 / (page + 1))
}

export function mergeProgressFloor(previousPercent, nextPercent) {
  const prev = Number.isFinite(previousPercent) ? previousPercent : 0
  const next = Number.isFinite(nextPercent) ? nextPercent : 0
  return Math.max(prev, Math.min(100, next))
}
