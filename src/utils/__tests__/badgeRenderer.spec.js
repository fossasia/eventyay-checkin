import {
  BADGE_ONLINE_ONLY_MESSAGE,
  buildBadgePdfData,
  canRenderBadgeLocally,
  fieldValue,
  getLayoutElements,
  layoutRequiresOnlineGeneration,
  renderBadgePdfFromLayout,
  resolvePageSize
} from '@/utils/badgeRenderer'
import { describe, expect, it } from 'vitest'

describe('badgeRenderer', () => {
  const defaultLayout = {
    id: 1,
    size: [{ width: 148, height: 105, orientation: 'landscape' }],
    layout: [
      {
        type: 'textarea',
        left: '0',
        bottom: '85',
        fontsize: '12.0',
        color: [0, 0, 0, 1],
        bold: true,
        italic: false,
        width: '80',
        content: 'attendee_name',
        align: 'center'
      },
      {
        type: 'textarea',
        left: '0',
        bottom: '83',
        fontsize: '10.0',
        color: [0, 0, 0, 1],
        width: '80.00',
        downward: true,
        content: 'attendee_job_title',
        align: 'center'
      },
      {
        type: 'textarea',
        left: '0',
        bottom: '76',
        fontsize: '12.0',
        color: [0, 0, 0, 1],
        width: '80',
        downward: true,
        content: 'attendee_company',
        align: 'center'
      },
      {
        type: 'barcodearea',
        left: '24.87',
        bottom: '34',
        size: '30.00',
        content: 'secret'
      }
    ]
  }

  it('parses layout JSON strings and resolves page orientation', () => {
    const parsed = getLayoutElements({
      layout: JSON.stringify(defaultLayout.layout)
    })
    expect(parsed).toHaveLength(4)

    const portrait = resolvePageSize([{ width: 148, height: 105, orientation: 'portrait' }])
    expect(portrait.widthMm).toBe(105)
    expect(portrait.heightMm).toBe(148)
  })

  it('builds pdf_data fallbacks from snapshot position fields', () => {
    const { pdfData, secret } = buildBadgePdfData({
      positionHint: { attendee_name: 'Ada Lovelace', company: 'Analytical Engines' },
      snapshotRecord: { secret: 'sec-1', attendeeEmail: 'ada@example.test' }
    })
    expect(secret).toBe('sec-1')
    expect(pdfData.attendee_name).toBe('Ada Lovelace')
    expect(pdfData.attendee_email).toBe('ada@example.test')
    expect(pdfData.attendee_company).toBe('Analytical Engines')
  })

  it('maps item content key to event_name', () => {
    expect(fieldValue({ event_name: 'Demo Conf' }, 'item')).toBe('Demo Conf')
  })

  it('detects when local render is possible', () => {
    expect(canRenderBadgeLocally(defaultLayout)).toBe(true)
    expect(canRenderBadgeLocally(null)).toBe(false)
    expect(canRenderBadgeLocally({ layout: [] })).toBe(false)
  })

  it('requires online generation only for per-attendee image areas', () => {
    const withImage = {
      layout: [{ type: 'imagearea', content: 'question_photo', left: '10', bottom: '10', width: '30', height: '40' }]
    }
    expect(layoutRequiresOnlineGeneration(withImage)).toBe(true)
    expect(canRenderBadgeLocally(withImage)).toBe(false)
    expect(layoutRequiresOnlineGeneration({ layout: [{ type: 'poweredby', content: 'dark' }] })).toBe(false)
    expect(canRenderBadgeLocally({ layout: [{ type: 'poweredby', content: 'dark' }] })).toBe(true)
    expect(layoutRequiresOnlineGeneration(defaultLayout)).toBe(false)
    expect(BADGE_ONLINE_ONLY_MESSAGE).toMatch(/go online/i)
  })

  it('embeds a synced powered-by PNG', async () => {
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const blob = await renderBadgePdfFromLayout({
      layout: {
        size: [{ width: 148, height: 105, orientation: 'landscape' }],
        layout: [{ type: 'poweredby', content: 'dark', left: '10', bottom: '10', size: '20' }]
      },
      printAssets: { poweredByDark: png }
    })
    expect(blob.size).toBeGreaterThan(100)
  })

  it('renders the default badge layout with downward fields and QR payload', async () => {
    const blob = await renderBadgePdfFromLayout({
      layout: defaultLayout,
      pdfData: {
        attendee_name: 'Ada Lovelace',
        attendee_job_title: 'Engineer',
        attendee_company: 'FOSSASIA',
        event_name: 'Demo Event',
        secret: 'sec-offline-1',
        pseudonymization_id: 'lead-42'
      },
      secret: 'sec-offline-1'
    })
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('application/pdf')
    expect(blob.size).toBeGreaterThan(500)
  })

  it('renders custom question fields and other-content placeholders', async () => {
    const layout = {
      size: [{ width: 148, height: 105, orientation: 'landscape' }],
      layout: [
        {
          type: 'textarea',
          left: '10',
          bottom: '80',
          fontsize: '14',
          color: [0, 0, 0, 1],
          width: '120',
          content: 'question_42',
          align: 'center'
        },
        {
          type: 'textarea',
          left: '10',
          bottom: '70',
          fontsize: '10',
          color: [0, 0, 0, 1],
          width: '120',
          content: 'other',
          text: '{attendee_name} · {event_name}',
          align: 'center'
        }
      ]
    }

    const blob = await renderBadgePdfFromLayout({
      layout,
      pdfData: {
        attendee_name: 'Ada Lovelace',
        event_name: 'Demo Event',
        question_42: 'Vegan'
      }
    })
    expect(blob.size).toBeGreaterThan(200)
  })

  it('renders portrait layouts from stringified layout definitions', async () => {
    const blob = await renderBadgePdfFromLayout({
      layout: {
        size: [{ width: 148, height: 105, orientation: 'portrait' }],
        layout: JSON.stringify([
          {
            type: 'textarea',
            left: '8',
            bottom: '95',
            fontsize: '20',
            color: [0, 0, 0, 1],
            width: '90',
            content: 'attendee_name',
            align: 'left'
          },
          {
            type: 'barcodearea',
            left: '30',
            bottom: '20',
            size: '35',
            content: 'secret'
          }
        ])
      },
      pdfData: {
        attendee_name: 'Portrait Guest',
        event_name: 'Vertical Event',
        secret: 'sec-portrait'
      },
      secret: 'sec-portrait'
    })
    expect(blob.size).toBeGreaterThan(400)
  })

  it('embeds a synced background PDF as the badge page', async () => {
    const { PDFDocument } = await import('pdf-lib')
    const bgDoc = await PDFDocument.create()
    bgDoc.addPage([420, 297])
    const bgBytes = await bgDoc.save()
    const backgroundPdf = btoa(String.fromCharCode(...bgBytes))

    const blob = await renderBadgePdfFromLayout({
      layout: {
        ...defaultLayout,
        backgroundPdf
      },
      pdfData: {
        attendee_name: 'Ada Lovelace',
        attendee_job_title: 'Engineer',
        attendee_company: 'FOSSASIA',
        event_name: 'Demo Event',
        secret: 'sec-bg'
      },
      secret: 'sec-bg'
    })
    expect(blob.size).toBeGreaterThan(800)
  })
})
