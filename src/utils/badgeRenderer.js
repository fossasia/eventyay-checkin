import { shapeArabicForPdf } from '@/utils/arabicPdfText'
import fontkit from '@pdf-lib/fontkit'
import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import QRCode from 'qrcode'

const MM_TO_PT = 72 / 25.4
const RENDERABLE_TYPES = new Set(['textarea', 'text', 'barcodearea', 'poweredby'])
const ONLINE_ONLY_TYPES = new Set(['imagearea'])

export const BADGE_ONLINE_ONLY_MESSAGE =
  'This badge uses images or other artifacts that can only be generated online. Please go online to continue with badge generation.'

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
  if (content === 'other' || content === 'other_i18n') {
    return resolveOtherText(element.text, pdfData, secret)
  }
  return fieldValue(pdfData, content, secret)
}

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/
const DEVANAGARI_RE = /[\u0900-\u097F]/

function scriptOfChar(ch) {
  if (ARABIC_RE.test(ch)) {
    return 'arabic'
  }
  if (DEVANAGARI_RE.test(ch)) {
    return 'devanagari'
  }
  return 'latin'
}

export function splitScriptRuns(text) {
  const runs = []
  for (const ch of String(text || '')) {
    const script = scriptOfChar(ch)
    const last = runs[runs.length - 1]
    if (last && last.script === script) {
      last.text += ch
    } else {
      runs.push({ script, text: ch })
    }
  }
  return runs
}

function fontHasGlyphs(font, text) {
  if (!font || !text) {
    return false
  }
  try {
    font.encodeText(text)
    return true
  } catch {
    return false
  }
}

function textWidth(font, text, fontSize) {
  if (!font || !text) {
    return 0
  }
  try {
    return font.widthOfTextAtSize(text, fontSize)
  } catch {
    return String(text).length * fontSize * 0.5
  }
}

function resolveRunFont(run, element, fonts) {
  let font = pickFont(element, fonts)
  if (run.script === 'arabic') {
    font = (element.bold ? fonts.arabicBold : fonts.arabic) || fonts.arabic || font
  } else if (run.script === 'devanagari') {
    font = (element.bold ? fonts.devanagariBold : fonts.devanagari) || fonts.devanagari || font
  }
  if (fontHasGlyphs(font, run.text)) {
    return font
  }
  if (fonts.and && fontHasGlyphs(fonts.and, run.text)) {
    return fonts.and
  }
  if (fonts.fallback && fontHasGlyphs(fonts.fallback, run.text)) {
    return fonts.fallback
  }
  return fonts.and || fonts.fallback || font
}

function lineWidth(line, element, fonts, fontSize) {
  return splitScriptRuns(line).reduce(
    (width, run) => width + textWidth(resolveRunFont(run, element, fonts), run.text, fontSize),
    0
  )
}

function wrapTextLines(text, element, fonts, fontSize, maxWidthPt) {
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
    if (lineWidth(candidate, element, fonts, fontSize) <= maxWidthPt) {
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
  const eventLabel =
    fieldValue(pdfData, 'event_name', secret) || fieldValue(pdfData, 'event', secret)
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

function pickFont(element, fonts) {
  if (element.bold && element.italic) {
    return fonts.boldItalic || fonts.bold || fonts.regular
  }
  if (element.italic) {
    return fonts.italic || fonts.regular
  }
  if (element.bold) {
    return fonts.bold || fonts.regular
  }
  return fonts.regular
}

function alignedX(left, boxWidth, textWidth, align) {
  if (align === 'center') {
    return left + (boxWidth - textWidth) / 2
  }
  if (align === 'right') {
    return left + boxWidth - textWidth
  }
  return left
}

function drawTextarea(page, element, pdfData, secret, fonts) {
  const text = shapeArabicForPdf(textareaContent(element, pdfData, secret))
  if (!text) {
    return
  }

  let fontSize = Number(element.fontsize) || 12
  const baseFont = pickFont(element, fonts)
  const color = layoutColorToRgb(element.color)
  const boxWidth = element.width != null ? mm(element.width) : page.getWidth()
  const left = mm(element.left)
  const bottom = mm(element.bottom)
  const rotation = Number(element.rotation || 0)
  const leading = fontSize

  if (element.autofit_width) {
    while (fontSize > 6 && lineWidth(text, element, fonts, fontSize) > boxWidth) {
      fontSize -= 0.5
    }
  }

  const lines = wrapTextLines(text, element, fonts, fontSize, boxWidth)
  const descent = Math.abs(
    baseFont.heightAtSize(fontSize, { descender: true }) - baseFont.heightAtSize(fontSize)
  )
  const blockHeight = lines.length * leading

  const drawLine = (line, startX, y) => {
    let x = startX
    for (const run of splitScriptRuns(line)) {
      const font = resolveRunFont(run, element, fonts)
      const width = textWidth(font, run.text, fontSize)
      try {
        page.drawText(run.text, {
          x: Math.max(0, x),
          y,
          size: fontSize,
          font,
          color,
          rotate: degrees(-rotation)
        })
      } catch (error) {
        console.warn('Could not draw badge text run', error)
      }
      x += width
    }
  }

  if (element.downward) {
    let y = bottom - descent / 2 - leading
    for (const line of lines) {
      drawLine(
        line,
        alignedX(left, boxWidth, lineWidth(line, element, fonts, fontSize), element.align),
        y
      )
      y -= leading
    }
    return
  }

  let y = bottom + blockHeight - descent
  for (const line of lines) {
    drawLine(
      line,
      alignedX(left, boxWidth, lineWidth(line, element, fonts, fontSize), element.align),
      y
    )
    y -= leading
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

function decodeBase64Bytes(encoded) {
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

function decodeBackgroundBytes(layout, backgroundBytes = null) {
  if (backgroundBytes) {
    return backgroundBytes instanceof Uint8Array ? backgroundBytes : new Uint8Array(backgroundBytes)
  }
  return decodeBase64Bytes(layout?.backgroundPdf)
}

async function embedCustomFonts(pdfDoc, printAssets = {}) {
  pdfDoc.registerFontkit(fontkit)
  const embed = async (key, fallback) => {
    const bytes = decodeBase64Bytes(printAssets?.[key])
    if (!bytes) {
      return fallback
    }
    try {
      return await pdfDoc.embedFont(bytes, { subset: true })
    } catch {
      return fallback
    }
  }
  const regular = await embed('regular', await pdfDoc.embedFont(StandardFonts.Helvetica))
  const bold = await embed('bold', await pdfDoc.embedFont(StandardFonts.HelveticaBold))
  const italic = await embed('italic', regular)
  const boldItalic = await embed('boldItalic', bold)
  const and = await embed('and', null)
  const arabic = await embed('arabic', null)
  const arabicBold = await embed('arabicBold', arabic)
  const devanagari = await embed('devanagari', null)
  const devanagariBold = await embed('devanagariBold', devanagari)
  const fallback = await embed('fallback', null)
  return {
    regular,
    bold,
    italic,
    boldItalic,
    and,
    arabic,
    arabicBold,
    devanagari,
    devanagariBold,
    fallback
  }
}

async function drawPoweredBy(page, pdfDoc, element, printAssets) {
  const style =
    String(element.content || 'dark').toLowerCase() === 'white' ? 'poweredByWhite' : 'poweredByDark'
  const bytes = decodeBase64Bytes(printAssets?.[style] || printAssets?.poweredByDark)
  if (!bytes) {
    return
  }
  try {
    const image = await pdfDoc.embedPng(bytes)
    const height = mm(element.size || 20)
    const width = image.height ? height * (image.width / image.height) : height
    page.drawImage(image, {
      x: mm(element.left),
      y: mm(element.bottom),
      width,
      height
    })
  } catch (error) {
    console.warn('Could not draw powered-by mark', error)
  }
}

/**
 * Render a badge PDF from layout JSON + pdf_data map (no server PDF download).
 */
export async function renderBadgePdfFromLayout({
  layout,
  pdfData = {},
  size = null,
  secret = '',
  backgroundBytes = null,
  printAssets = {}
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

  const fonts = await embedCustomFonts(pdfDoc, printAssets)

  for (const element of elements) {
    if (!element || typeof element !== 'object') {
      continue
    }
    const type = element.type
    if (type === 'textarea' || type === 'text') {
      drawTextarea(page, element, pdfData, secret, fonts)
    } else if (type === 'barcodearea') {
      await drawBarcode(page, pdfDoc, element, pdfData, secret)
    } else if (type === 'poweredby') {
      await drawPoweredBy(page, pdfDoc, element, printAssets)
    }
  }

  const bytes = await pdfDoc.save()
  return new Blob([bytes], { type: 'application/pdf' })
}

export function layoutRequiresOnlineGeneration(layout) {
  return getLayoutElements(layout).some((element) => ONLINE_ONLY_TYPES.has(element?.type))
}

export function canRenderBadgeLocally(layout) {
  const elements = getLayoutElements(layout)
  if (!elements.some((element) => RENDERABLE_TYPES.has(element?.type))) {
    return false
  }
  return !layoutRequiresOnlineGeneration(layout)
}
