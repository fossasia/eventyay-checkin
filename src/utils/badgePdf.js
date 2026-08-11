import { resolveApiResourceUrl } from '@/utils/serverUrl'
import { DEVICE_PROFILE_DENIED_MESSAGE, isDeviceProfileDeniedResponse } from '@/utils/deviceErrors'

/**
 * Append or replace a `layout` query param on a badge download path/URL.
 */
export function withBadgeLayoutParam(badgePath, layoutId) {
  const path = String(badgePath || '').trim()
  if (!path) {
    return ''
  }
  if (layoutId == null || layoutId === '') {
    return path
  }

  const hashIndex = path.indexOf('#')
  const withoutHash = hashIndex >= 0 ? path.slice(0, hashIndex) : path
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : ''
  const queryIndex = withoutHash.indexOf('?')
  const base = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash
  const query = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : ''
  const params = new URLSearchParams(query)
  params.set('layout', String(layoutId))
  const qs = params.toString()
  return `${base}?${qs}${hash}`
}

function decodeBase64Pdf(base64, mimeType = 'application/pdf') {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: mimeType })
}

export async function fetchBadgePdf(badgePath, { baseUrl, apitoken } = {}) {
  const url = resolveApiResourceUrl(badgePath, baseUrl)
  if (!url) {
    return { status: 'error' }
  }

  const response = await fetch(url, {
    credentials: 'omit',
    headers: {
      Authorization: `Device ${apitoken}`,
      Accept: 'application/pdf'
    }
  })

  if (response.status === 202 || response.status === 409) {
    return { status: 'generating' }
  }

  if (!response.ok) {
    let detail = ''
    try {
      const body = await response.json()
      detail = String(body?.detail || body?.error || '')
    } catch {
      // Non-JSON error body
    }
    if (isDeviceProfileDeniedResponse(response.status, detail)) {
      return {
        status: 'error',
        httpStatus: response.status,
        detail: DEVICE_PROFILE_DENIED_MESSAGE,
        profileDenied: true
      }
    }
    return { status: 'error', httpStatus: response.status, detail }
  }

  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/pdf')) {
    const blob = await response.blob()
    return blob.size > 0 ? { status: 'ready', blob } : { status: 'error' }
  }

  let body
  try {
    body = await response.json()
  } catch {
    return { status: 'error' }
  }

  const base64 = body.pdf_base64 || body.base64_pdf || ''
  if (!base64) {
    if (body.status === 'generating') {
      return { status: 'generating' }
    }
    return { status: 'error' }
  }

  const mimeType = body.mimetype || body.type || 'application/pdf'
  return { status: 'ready', blob: decodeBase64Pdf(base64, mimeType) }
}

export async function fetchBadgePdfWithRetry(
  badgePath,
  options,
  { maxAttempts = 10, initialDelayMs = 400, delayMs = 1200 } = {}
) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await fetchBadgePdf(badgePath, options)
    if (result.status === 'ready') {
      return result
    }
    if (result.status === 'generating') {
      if (attempt < maxAttempts - 1) {
        const waitMs = attempt < 3 ? initialDelayMs : delayMs
        await new Promise((resolve) => setTimeout(resolve, waitMs))
        continue
      }
      return {
        status: 'error',
        detail: 'Badge generation timed out.'
      }
    }
    return result
  }
  return {
    status: 'error',
    detail: 'Badge generation timed out.'
  }
}

const PDF_PRINT_RENDER_DELAY_MS = 600
const PDF_SILENT_PRINT_RENDER_DELAY_MS = 900
const PDF_PRINT_DIALOG_TIMEOUT_MS = 45000
const PDF_INTERACTIVE_PRINT_DIALOG_TIMEOUT_MS = 30000
const PDF_PRINT_FOCUS_LISTEN_DELAY_MS = 250
const PDF_PRINT_CANCEL_DEBOUNCE_MS = 200

export const PRINT_OUTCOME = {
  PRINTED: 'printed',
  CANCELLED: 'cancelled',
  FAILED: 'failed'
}

let silentPrintFrame = null
let activePrintCleanup = null

function createPrintOutcomeResolver(onResolve) {
  let settled = false
  let sawPrintMode = false
  let gotAfterPrint = false

  const resolve = (outcome) => {
    if (settled) {
      return
    }
    settled = true
    onResolve(outcome)
  }

  return {
    isSettled: () => settled,
    markPrintMode: () => {
      sawPrintMode = true
    },
    onAfterPrint: (silent) => {
      gotAfterPrint = true
      if (silent) {
        resolve(PRINT_OUTCOME.PRINTED)
        return
      }
      resolve(sawPrintMode ? PRINT_OUTCOME.PRINTED : PRINT_OUTCOME.CANCELLED)
    },
    onFocusDismiss: (silent) => {
      if (gotAfterPrint) {
        return
      }
      if (silent) {
        resolve(PRINT_OUTCOME.CANCELLED)
        return
      }
      if (!sawPrintMode) {
        resolve(PRINT_OUTCOME.CANCELLED)
      }
    },
    onFailed: () => resolve(PRINT_OUTCOME.FAILED)
  }
}

function getSilentPrintFrame() {
  if (!silentPrintFrame && typeof document !== 'undefined') {
    silentPrintFrame = document.createElement('iframe')
    silentPrintFrame.setAttribute('title', 'Badge print')
    silentPrintFrame.style.cssText =
      'position:fixed;top:0;left:-10000px;width:0;height:0;border:0;visibility:hidden'
    document.body.appendChild(silentPrintFrame)
  }
  return silentPrintFrame
}

function attachPrintDialogCleanup(targetWindow, tracker, { silent }) {
  if (!targetWindow) {
    return () => {}
  }

  let closed = false
  const removers = []

  const closeOnce = () => {
    if (closed) {
      return
    }
    closed = true
    removers.forEach((remove) => {
      try {
        remove()
      } catch {
        // Listener may already be removed.
      }
    })
  }

  try {
    const onAfterPrint = () => {
      closeOnce()
      tracker.onAfterPrint(silent)
    }
    targetWindow.addEventListener('afterprint', onAfterPrint, { once: true })
    removers.push(() => targetWindow.removeEventListener('afterprint', onAfterPrint))
  } catch {
    // Ignore if the print context cannot register listeners.
  }

  try {
    const mediaQuery = targetWindow.matchMedia('print')
    const onPrintModeChange = (event) => {
      if (event.matches) {
        tracker.markPrintMode()
      }
    }
    mediaQuery.addEventListener('change', onPrintModeChange)
    removers.push(() => mediaQuery.removeEventListener('change', onPrintModeChange))

    const pollId = window.setInterval(() => {
      if (mediaQuery.matches) {
        tracker.markPrintMode()
      }
    }, 120)
    removers.push(() => window.clearInterval(pollId))
  } catch {
    // matchMedia unavailable in this context.
  }

  return () => {
    closeOnce()
  }
}

function listenForPrintDialogDismiss(tracker, { silent }) {
  let settled = false
  let focusTimer = null
  let debounceTimer = null

  const finish = () => {
    if (settled || tracker.isSettled()) {
      return
    }
    settled = true
    window.removeEventListener('focus', onWindowFocus)
    if (focusTimer) {
      window.clearTimeout(focusTimer)
    }
    if (debounceTimer) {
      window.clearTimeout(debounceTimer)
    }
    tracker.onFocusDismiss(silent)
  }

  const onWindowFocus = () => {
    if (debounceTimer) {
      window.clearTimeout(debounceTimer)
    }
    debounceTimer = window.setTimeout(finish, PDF_PRINT_CANCEL_DEBOUNCE_MS)
  }

  focusTimer = window.setTimeout(() => {
    window.addEventListener('focus', onWindowFocus)
  }, PDF_PRINT_FOCUS_LISTEN_DELAY_MS)

  return finish
}

function printPdfBlobInFrame(blob, { frame, renderDelayMs, revokeBlobUrl = true, dialogTimeoutMs, silent = false } = {}) {
  return new Promise((resolve) => {
    const blobUrl = URL.createObjectURL(blob)
    const iframe = frame || document.createElement('iframe')
    const ownsFrame = !frame
    const timeoutMs = dialogTimeoutMs ?? PDF_INTERACTIVE_PRINT_DIALOG_TIMEOUT_MS

    if (ownsFrame) {
      iframe.setAttribute('title', 'Badge print')
      iframe.style.cssText =
        'position:fixed;top:0;left:-10000px;width:0;height:0;border:0;visibility:hidden'
      document.body.appendChild(iframe)
    }

    let settled = false
    let detachDialogListeners = () => {}
    let stopFocusListen = () => {}
    let timeoutId = null
    let wrappedTracker = null

    const cleanup = () => {
      settled = true
      if (activePrintCleanup === abortPrint) {
        activePrintCleanup = null
      }
      detachDialogListeners()
      stopFocusListen()
      if (timeoutId) {
        window.clearTimeout(timeoutId)
        timeoutId = null
      }
      if (ownsFrame) {
        iframe.onload = null
        iframe.src = 'about:blank'
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe)
        }
      } else {
        iframe.onload = null
        iframe.removeAttribute('src')
      }
      if (revokeBlobUrl) {
        URL.revokeObjectURL(blobUrl)
      }
    }

    const finish = (outcome) => {
      if (settled) {
        return
      }
      cleanup()
      resolve(outcome)
    }

    wrappedTracker = createPrintOutcomeResolver(finish)

    const abortPrint = () => {
      if (!settled) {
        wrappedTracker.onFailed()
      }
    }

    activePrintCleanup = abortPrint

    const runPrint = () => {
      const targetWindow = iframe.contentWindow
      if (!targetWindow) {
        wrappedTracker.onFailed()
        return
      }

      detachDialogListeners = attachPrintDialogCleanup(targetWindow, wrappedTracker, { silent })

      setTimeout(() => {
        if (settled) {
          return
        }
        try {
          stopFocusListen = listenForPrintDialogDismiss(wrappedTracker, { silent })
          targetWindow.focus()
          targetWindow.print()
        } catch (error) {
          console.error('Print failed:', error)
          wrappedTracker.onFailed()
        }
      }, renderDelayMs)
    }

    iframe.onload = runPrint
    iframe.src = blobUrl

    timeoutId = window.setTimeout(() => {
      if (!settled) {
        wrappedTracker.onFailed()
      }
    }, timeoutMs)
  })
}

/** Stop waiting on the active print dialog (e.g. when closing the preview). */
export function cancelActivePrint() {
  activePrintCleanup?.()
  activePrintCleanup = null
  if (silentPrintFrame) {
    silentPrintFrame.onload = null
    silentPrintFrame.removeAttribute('src')
  }
}

function printPdfBlobSilent(blob) {
  return printPdfBlobInFrame(blob, {
    frame: getSilentPrintFrame(),
    renderDelayMs: PDF_SILENT_PRINT_RENDER_DELAY_MS,
    revokeBlobUrl: true,
    dialogTimeoutMs: PDF_PRINT_DIALOG_TIMEOUT_MS,
    silent: true
  })
}

export function printPdfBlob(blob, { silent = false } = {}) {
  if (silent) {
    return printPdfBlobSilent(blob)
  }

  return printPdfBlobInFrame(blob, {
    renderDelayMs: PDF_PRINT_RENDER_DELAY_MS,
    revokeBlobUrl: true,
    silent: false
  })
}

export function downloadPdfBlob(blob, filename = 'ticket.pdf') {
  if (!blob || typeof window === 'undefined') {
    return false
  }

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
  return true
}
