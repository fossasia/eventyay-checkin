export const CUSTOM_ORIGIN_WEBSITE = 'custom'

export const DEFAULT_ORIGIN_WEBSITE = 'https://eventyay.com'

export const ORIGIN_WEBSITE_OPTIONS = [
  { value: 'https://dev.eventyay.com', label: 'https://dev.eventyay.com' },
  { value: 'https://eventyay.com', label: 'https://eventyay.com' },
  { value: 'https://wikimedia.eventyay.com', label: 'https://wikimedia.eventyay.com' },
  { value: CUSTOM_ORIGIN_WEBSITE, label: 'Custom' }
]

export function resolveOriginWebsite(choice, customUrl = '') {
  if (choice === CUSTOM_ORIGIN_WEBSITE) {
    return String(customUrl || '').trim()
  }
  return String(choice || '').trim()
}
