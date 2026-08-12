import { describe, expect, it } from 'vitest'
import { canRenderBadgeLocally, renderBadgePdfFromLayout } from '@/utils/badgeRenderer'

describe('badgeRenderer', () => {
  const layout = {
    id: 1,
    size: [{ width: 148, height: 105, orientation: 'landscape' }],
    layout: [
      {
        type: 'textarea',
        left: '10',
        bottom: '80',
        fontsize: '14',
        color: [0, 0, 0, 1],
        bold: true,
        width: '120',
        content: 'attendee_name',
        align: 'center'
      },
      {
        type: 'textarea',
        left: '10',
        bottom: '70',
        fontsize: '10',
        color: [0, 0, 0, 1],
        width: '120',
        content: 'question_42',
        align: 'center'
      },
      {
        type: 'barcodearea',
        left: '50',
        bottom: '20',
        size: '30',
        content: 'secret'
      }
    ]
  }

  it('detects when local render is possible', () => {
    expect(canRenderBadgeLocally(layout, { attendee_name: 'Ada' })).toBe(true)
    expect(canRenderBadgeLocally(null, { attendee_name: 'Ada' })).toBe(false)
  })

  it('renders a PDF blob using layout JSON and dynamic pdf_data fields', async () => {
    const blob = await renderBadgePdfFromLayout({
      layout,
      pdfData: {
        attendee_name: 'Ada Lovelace',
        question_42: 'Vegan',
        secret: 'sec-offline-1'
      },
      secret: 'sec-offline-1'
    })
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('application/pdf')
    expect(blob.size).toBeGreaterThan(100)
  })
})
