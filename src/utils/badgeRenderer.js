import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import QRCode from 'qrcode'

const MM_TO_PT = 72 / 25.4
const RENDERABLE_TYPES = new Set(['textarea', 'text', 'barcodearea'])

function mm(value) {
  return Number(value || 0) * MM_TO_PT
}

export function getLayoutElements(layout) {
  if (!layout) {
    return []
  }
  let elements = layout.layout ?? layout
  if (typeof elements === 'string') {
    try {
      elements = JSON.parse(elements)
    } catch {
      return []
    }
  }
  return Array.isArray(elements) ? elements : []
}

function resolveContentKey(content) {
  const key = String(content || '').trim()
  if (key === 'item') {
    return 'event_name'
  }
  return key
}

function layoutColorToRgb(color) {
  if (!Array.isArray(color) || color.length < 3) {
    return rgb(0, 0, 0)
  }
  const [r, g, b] = color.map((channel) => Math.min(1, Math.max(0, Number(channel) / 255)))
  return rgb(r, g, b)
}

export function resolvePageSize(size) {
  const first = Array.isArray(size) ? size[0] : size
  let widthMm = Number(first?.width) || 148
  let heightMm = Number(first?.height) || 105
  const orientation = String(first?.orientation || 'landscape').toLowerCase()
  if (orientation === 'portrait' && widthMm > heightMm) {
    ;[widthMm, heightMm] = [heightMm, widthMm]
  } else if (orientation === 'landscape' && heightMm > widthMm) {
    ;[widthMm, heightMm] = [heightMm, widthMm]
  }
  return { width: mm(widthMm), height: mm(heightMm), widthMm, heightMm }
}

function resolveOtherText(text, pdfData, secret) {
  return String(text || '').replace(/\{([^}]+)\}/g, (_, rawKey) => {
    const key = resolveContentKey(rawKey.trim())
    return fieldValue(pdfData, key, secret)
  })
}

export function fieldValue(pdfData, contentKey, secret = '') {
  const key = resolveContentKey(contentKey)
  if (!key) {
    return ''
  }
  if (key === 'secret') {
    return pdfData?.secret || secret || ''
  }
  const value = pdfData?.[key]
  if (value == null || value === '') {
    return ''
  }
  if (typeof value === 'object') {
    return ''
  }
  return String(value)
}

export function buildBadgePdfData({ positionHint = null, snapshotRecord = null } = {}) {
  const hint = positionHint || {}
  const record = snapshotRecord || {}
  const pdfData = {
    ...(record.pdfData || {}),
    ...(hint.pdf_data || {})
  }

  if (!pdfData.attendee_name) {
    pdfData.attendee_name = hint.attendee_name || record.attendeeName || ''
  }
  if (!pdfData.attendee_email) {
    pdfData.attendee_email = hint.attendee_email || record.attendeeEmail || ''
  }
  if (!pdfData.attendee_company) {
    pdfData.attendee_company =
      hint.company || record.company || pdfData.attendee_company || pdfData.company || ''
  }
  if (!pdfData.attendee_job_title) {
    pdfData.attendee_job_title =
      hint.job_title || record.jobTitle || pdfData.attendee_job_title || pdfData.job_title || ''
  }

  const secret = String(hint.secret || record.secret || pdfData.secret || '').trim()
  if (secret) {
    pdfData.secret = secret
  }

  return { pdfData, secret }
}

function textareaContent(element, pdfData, secret) {
  const content = element?.content
  if (content === 'other') {
    return resolveOtherText(element.text, pdfData, secret)
  }
  return fieldValue(pdfData, content, secret)
}

function wrapTextLines(text, font, fontSize, maxWidthPt) {
  const normalized = String(text || '').trim()
  if (!normalized) {
    return []
  }
  if (!maxWidthPt || maxWidthPt <= 0) {
    return [normalized]
  }

  const words = normalized.split(/\s+/)
  const lines = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidthPt) {
      current = candidate
      continue
    }
    if (current) {
      lines.push(current)
    }
    current = word
  }
  if (current) {
    lines.push(current)
  }
  return lines.length ? lines : [normalized]
}

function buildBarcodePayload(pdfData, secret) {
  const ticket = fieldValue(pdfData, 'secret', secret)
  const eventLabel = fieldValue(pdfData, 'event_name', secret) || fieldValue(pdfData, 'event', secret)
  const lead =
    fieldValue(pdfData, 'pseudonymization_id', secret) || fieldValue(pdfData, 'lead', secret)
  return JSON.stringify({
    event: eventLabel,
    ticket,
    lead
  })
}

function qrErrorCorrectionLevel(payload) {
  if (payload.length > 128) {
    return 'L'
  }
  if (payload.length > 32) {
    return 'M'
  }
  return 'H'
}

async function embedQrPng(pdfDoc, text, sizePt) {
  const dataUrl = await QRCode.toDataURL(String(text || ''), {
    errorCorrectionLevel: qrErrorCorrectionLevel(String(text || '')),
    margin: 0,
    width: Math.max(96, Math.round(sizePt * 3))
  })
  const base64 = dataUrl.split(',')[1]
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  return pdfDoc.embedPng(bytes)
}

function drawTextarea(page, element, pdfData, secret, fonts) {
  const text = textareaContent(element, pdfData, secret)
  if (!text) {
    return
  }

  const fontSize = Number(element.fontsize) || 12
  const font = element.bold ? fonts.bold : fonts.regular
  const color = layoutColorToRgb(element.color)
  const boxWidth = element.width != null ? mm(element.width) : page.getWidth()
  const left = mm(element.left)
  const bottom = mm(element.bottom)
  const rotation = Number(element.rotation || 0)
  const lineHeight = fontSize * 1.15

  if (element.downward) {
    page.drawText(text, {
      x: left,
      y: bottom,
      size: fontSize,
      font,
      color,
      rotate: degrees(-90 - rotation)
    })
    return
  }

  const lines = wrapTextLines(text, font, fontSize, boxWidth)
  let cursorY = bottom + lineHeight * 0.85
  for (const line of lines) {
    const textWidth = font.widthOfTextAtSize(line, fontSize)
    let drawX = left
    if (element.align === 'center') {
      drawX = left + (boxWidth - textWidth) / 2
    } else if (element.align === 'right') {
      drawX = left + boxWidth - textWidth
    }
    page.drawText(line, {
      x: Math.max(0, drawX),
      y: cursorY,
      size: fontSize,
      font,
      color,
      maxWidth: boxWidth || undefined,
      rotate: degrees(-rotation)
    })
    cursorY += lineHeight
  }
}

async function drawBarcode(page, pdfDoc, element, pdfData, secret) {
  const payload = buildBarcodePayload(pdfData, secret)
  if (!payload || payload === '{"event":"","ticket":"","lead":""}') {
    return
  }
  const sizePt = mm(element.size || 30)
  const qrImage = await embedQrPng(pdfDoc, payload, sizePt)
  page.drawImage(qrImage, {
    x: mm(element.left),
    y: mm(element.bottom),
    width: sizePt,
    height: sizePt
  })
}

function decodeBackgroundBytes(layout, backgroundBytes = null) {
  if (backgroundBytes) {
    return backgroundBytes instanceof Uint8Array ? backgroundBytes : new Uint8Array(backgroundBytes)
  }
  const encoded = layout?.backgroundPdf
  if (!encoded || typeof encoded !== 'string') {
    return null
  }
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Render a badge PDF from layout JSON + pdf_data map (no server PDF download).
 */
export async function renderBadgePdfFromLayout({
  layout,
  pdfData = {},
  size = null,
  secret = '',
  backgroundBytes = null
} = {}) {
  const elements = getLayoutElements(layout)
  const bgBytes = decodeBackgroundBytes(layout, backgroundBytes)

  const pdfDoc = await PDFDocument.create()
  let page
  if (bgBytes) {
    try {
      const bgDoc = await PDFDocument.load(bgBytes)
      const [bgPage] = await pdfDoc.copyPages(bgDoc, [0])
      page = pdfDoc.addPage(bgPage)
    } catch {
      page = null
    }
  }
  if (!page) {
    const pageSize = resolvePageSize(size || layout?.size)
    page = pdfDoc.addPage([pageSize.width, pageSize.height])
  }

  const fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  }

  for (const element of elements) {
    if (!element || typeof element !== 'object') {
      continue
    }
    const type = element.type
    if (type === 'textarea' || type === 'text') {
      drawTextarea(page, element, pdfData, secret, fonts)
    } else if (type === 'barcodearea') {
      await drawBarcode(page, pdfDoc, element, pdfData, secret)
    } else if (type === 'imagearea') {
      const width = mm(element.width)
      const height = mm(element.height)
      page.drawRectangle({
        x: mm(element.left),
        y: mm(element.bottom),
        width,
        height,
        color: rgb(0.8, 0.8, 0.8)
      })
    }
  }

  const bytes = await pdfDoc.save()
  return new Blob([bytes], { type: 'application/pdf' })
}

export function canRenderBadgeLocally(layout, pdfData = null) {
  const elements = getLayoutElements(layout)
  if (!elements.some((element) => RENDERABLE_TYPES.has(element?.type))) {
    return false
  }
  if (!pdfData || typeof pdfData !== 'object') {
    return true
  }
  return true
}
