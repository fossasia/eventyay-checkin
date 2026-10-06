import { createI18n } from 'vue-i18n'
import {
  DEFAULT_LOCALE,
  FALLBACK_LOCALE,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  getLocaleDirection,
  isSupportedLocale,
  normalizeLocale
} from './locales'

const localeModules = import.meta.glob('@/locales/*.json', { eager: true })
const messages = {}

for (const [filePath, moduleContent] of Object.entries(localeModules)) {
  const match = filePath.match(/\/([^/]+)\.json$/)
  if (match) {
    const localeCode = match[1]
    messages[localeCode] = moduleContent.default || moduleContent
  }
}

// Aliases for backward compatibility
if (messages.zh_Hans && !messages.zh) {
  messages.zh = messages.zh_Hans
}
if (messages.pt_BR && !messages.pt) {
  messages.pt = messages.pt_BR
}

export function detectUserLocale() {
  if (typeof window === 'undefined') {
    return DEFAULT_LOCALE
  }

  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (saved && isSupportedLocale(saved)) {
      return normalizeLocale(saved)
    }
  } catch {
    // Ignore storage errors
  }

  try {
    const navLangs = navigator.languages || [navigator.language || '']
    for (const raw of navLangs) {
      if (!raw) continue
      const norm = normalizeLocale(raw, null)
      if (norm) {
        return norm
      }
    }
  } catch {
    // Ignore browser detection errors
  }

  return DEFAULT_LOCALE
}

export function updateDocumentAttributes(locale) {
  if (typeof document === 'undefined') {
    return
  }
  const norm = normalizeLocale(locale)
  const dir = getLocaleDirection(norm)
  document.documentElement.lang = norm.replace(/_/g, '-')
  document.documentElement.dir = dir
}

const initialLocale = detectUserLocale()
updateDocumentAttributes(initialLocale)

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale,
  fallbackLocale: FALLBACK_LOCALE,
  missingWarn: false,
  fallbackWarn: false,
  messages
})

export function setLocale(newLocale) {
  const norm = normalizeLocale(newLocale, null)
  if (!norm) {
    console.warn(`[i18n] Unsupported locale: ${newLocale}`)
    return
  }

  if (i18n.mode === 'legacy') {
    i18n.global.locale = norm
  } else {
    i18n.global.locale.value = norm
  }

  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, norm)
  } catch {
    // Ignore storage errors
  }

  updateDocumentAttributes(norm)
}

export function getCurrentLocale() {
  return i18n.mode === 'legacy' ? i18n.global.locale : i18n.global.locale.value
}

export function translate(...args) {
  return i18n.global.t(...args)
}

export const t = (...args) => i18n.global.t(...args)

export {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  FALLBACK_LOCALE,
  LOCALE_STORAGE_KEY,
  getLocaleDirection,
  isSupportedLocale,
  normalizeLocale
}

export default i18n
