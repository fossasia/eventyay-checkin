import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import QRCode from 'qrcode'

const MM_TO_PT = 72 / 25.4

function mm(value) {
  return Number(value || 0) * MM_TO_PT
}

function resolvePageSize(size) {
  const first = Array.isArray(size) ? size[0] : size
  const widthMm = Number(first?.width) || 148
  const heightMm = Number(first?.height) || 105
  return { width: mm(widthMm), height: mm(heightMm), widthMm, heightMm }
}

function cmykToRgb(color) {
  if (!Array.isArray(color) || color.length < 3) {
    return rgb(0, 0, 0)
  }
  const [c, m, y, k = 0] = color.map(Number)
  const r = 1 - Math.min(1, c * (1 - k) + k)
  const g = 1 - Math.min(1, m * (1 - k) + k)
  const b = 1 - Math.min(1, y * (1 - k) + k)
  return rgb(r, g, b)
}

function fieldValue(pdfData, contentKey, fallbackSecret = '') {
  if (!contentKey) {
    return ''
  }
  if (contentKey === 'secret') {
    return pdfData?.secret || fallbackSecret || ''
  }
  const value = pdfData?.[contentKey]
  if (value == null) {
    return ''
  }
  return String(value)
}

async function embedQrPng(pdfDoc, text, sizePt) {
  const dataUrl = await QRCode.toDataURL(String(text || ''), {
    errorCorrectionLevel: 'M',
    margin: 0,
    width: Math.max(64, Math.round(sizePt * 2))
  })
  const base64 = dataUrl.split(',')[1]
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  return pdfDoc.embedPng(bytes)
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
  const elements = Array.isArray(layout?.layout) ? layout.layout : Array.isArray(layout) ? layout : []
  const pageSize = resolvePageSize(size || layout?.size)

  const pdfDoc = await PDFDocument.create()
  let page
  if (backgroundBytes) {
    try {
      const bgDoc = await PDFDocument.load(backgroundBytes)
      const [bgPage] = await pdfDoc.copyPages(bgDoc, [0])
      page = pdfDoc.addPage(bgPage)
      page.setSize(pageSize.width, pageSize.height)
    } catch {
      page = pdfDoc.addPage([pageSize.width, pageSize.height])
    }
  } else {
    page = pdfDoc.addPage([pageSize.width, pageSize.height])
  }

  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  for (const element of elements) {
    if (!element || typeof element !== 'object') {
      continue
    }
    if (element.type === 'textarea') {
      const text = fieldValue(pdfData, element.content, secret)
      if (!text) {
        continue
      }
      const fontSize = Number(element.fontsize) || 12
      const font = element.bold ? fontBold : fontRegular
      const color = cmykToRgb(element.color)
      const x = mm(element.left)
      const textWidth = font.widthOfTextAtSize(text, fontSize)
      const boxWidth = element.width != null ? mm(element.width) : textWidth
      let drawX = x
      if (element.align === 'center') {
        drawX = x + (boxWidth - textWidth) / 2
      } else if (element.align === 'right') {
        drawX = x + boxWidth - textWidth
      }
      const y = mm(element.bottom)
      page.drawText(text, {
        x: Math.max(0, drawX),
        y,
        size: fontSize,
        font,
        color,
        maxWidth: boxWidth || undefined
      })
    } else if (element.type === 'barcodearea') {
      const value = fieldValue(pdfData, element.content || 'secret', secret)
      if (!value) {
        continue
      }
      const sizePt = mm(element.size || 30)
      const qrImage = await embedQrPng(pdfDoc, value, sizePt)
      page.drawImage(qrImage, {
        x: mm(element.left),
        y: mm(element.bottom),
        width: sizePt,
        height: sizePt
      })
    }
  }

  const bytes = await pdfDoc.save()
  return new Blob([bytes], { type: 'application/pdf' })
}

export function canRenderBadgeLocally(layout, pdfData) {
  return Boolean(layout && (Array.isArray(layout.layout) || Array.isArray(layout)) && pdfData)
}
