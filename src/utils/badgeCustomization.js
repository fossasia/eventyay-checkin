export function parseBadgeCustomizationResult(result) {
  if (Array.isArray(result)) {
    return { hiddenFields: result, fieldOverrides: {}, layoutId: null }
  }

  return {
    hiddenFields: result?.hiddenFields || [],
    fieldOverrides: result?.fieldOverrides || {},
    layoutId: result?.layoutId ?? null
  }
}

export function normalizeBadgeCustomizationState({ hiddenFields = [], fieldOverrides = {} } = {}) {
  const hidden = (Array.isArray(hiddenFields) ? hiddenFields : [])
    .map((value) => String(value).trim())
    .filter(Boolean)
    .sort()

  const overrides = {}
  for (const [key, value] of Object.entries(fieldOverrides || {})) {
    const trimmed = String(value || '').trim()
    if (trimmed) {
      overrides[String(key)] = trimmed
    }
  }

  return { hiddenFields: hidden, fieldOverrides: overrides }
}

export function isBadgeCustomizationUnchanged(customization, result) {
  if (!customization) {
    return false
  }

  const current = normalizeBadgeCustomizationState({
    hiddenFields: customization.hidden_fields || [],
    fieldOverrides: customization.field_overrides || {}
  })
  const next = normalizeBadgeCustomizationState(parseBadgeCustomizationResult(result))
  return JSON.stringify(current) === JSON.stringify(next)
}
