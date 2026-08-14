import { resolveServerUrl } from '@/utils/serverUrl'

const PRINT_ASSET_PATHS = {
  regular: '/static/fonts/opensans_regular_macroman/OpenSans-Regular-webfont.ttf',
  bold: '/static/fonts/opensans_bold_macroman/OpenSans-Bold-webfont.ttf',
  italic: '/static/fonts/opensans_italic_macroman/OpenSans-Italic-webfont.ttf',
  boldItalic: '/static/fonts/opensans_bolditalic_macroman/OpenSans-BoldItalic-webfont.ttf',
  poweredByDark: '/static/pretixpresale/pdf/powered_by_eventyay_dark.png',
  poweredByWhite: '/static/pretixpresale/pdf/powered_by_eventyay_white.png'
}

let pendingPrintSync = null

export function setPendingPrintSync(context) {
  pendingPrintSync = context?.url && context?.apitoken ? { ...context } : null
}

function joinUrl(baseUrl, path) {
  const base = resolveServerUrl(baseUrl).replace(/\/+$/, '')
  if (/^https?:\/\//i.test(path)) {
    try {
      const parsed = new URL(path)
      return `${base}${parsed.pathname}${parsed.search}`
    } catch {
      return path
    }
  }
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

async function fetchAssetBytes(baseUrl, apitoken, pathOrUrl) {
  const raw = String(pathOrUrl || '').trim()
  if (!raw) {
    return null
  }
  const url = /^https?:\/\//i.test(raw) ? raw : joinUrl(baseUrl, raw)
  try {
    const response = await fetch(url, {
      credentials: 'omit',
      headers: {
        Authorization: `Device ${apitoken}`,
        Accept: 'application/pdf, image/*, font/ttf, application/octet-stream, */*'
      }
    })
    if (!response.ok) {
      return null
    }
    const buffer = await response.arrayBuffer()
    if (!buffer.byteLength) {
      return null
    }
    return new Uint8Array(buffer)
  } catch {
    return null
  }
}

function bytesToBase64(bytes) {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

function layoutList(index) {
  if (!index?.layouts) {
    return []
  }
  if (index.layouts instanceof Map) {
    return [...index.layouts.values()]
  }
  return Object.values(index.layouts)
}

export async function syncBadgePrintAssets(index, { url, apitoken, organizer, eventSlug } = {}) {
  if (!index || !url || !apitoken || !organizer || !eventSlug) {
    return
  }

  for (const layout of layoutList(index)) {
    const layoutId = layout?.id
    if (!layoutId || layout.backgroundPdf) {
      continue
    }
    const endpointPath = `/api/v1/organizers/${organizer}/events/${eventSlug}/badgelayouts/${layoutId}/background/`
    let bytes = await fetchAssetBytes(url, apitoken, endpointPath)
    if (!bytes && layout.background) {
      bytes = await fetchAssetBytes(url, apitoken, layout.background)
    }
    if (bytes) {
      layout.backgroundPdf = bytesToBase64(bytes)
    }
  }

  const assets = { ...(index.printAssets || {}) }
  for (const [key, path] of Object.entries(PRINT_ASSET_PATHS)) {
    if (assets[key]) {
      continue
    }
    const bytes = await fetchAssetBytes(url, apitoken, path)
    if (bytes) {
      assets[key] = bytesToBase64(bytes)
    }
  }
  index.printAssets = assets
}

export async function flushPendingPrintSync(index, apitoken) {
  const context = pendingPrintSync
  if (!context) {
    return
  }
  await syncBadgePrintAssets(index, {
    url: context.url,
    apitoken: apitoken || context.apitoken,
    organizer: context.organizer,
    eventSlug: context.eventSlug
  })
  pendingPrintSync = null
}
