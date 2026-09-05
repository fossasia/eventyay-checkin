import { PRINT_ASSET_PATHS } from '@/offline/badgePrintAssets'
import {
  BADGE_ONLINE_ONLY_MESSAGE,
  buildBadgePdfData,
  canRenderBadgeLocally,
  fieldValue,
  getLayoutElements,
  layoutRequiresOnlineGeneration,
  renderBadgePdfFromLayout,
  resolvePageSize,
  splitScriptRuns
} from '@/utils/badgeRenderer'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const EVENTYAY_FONTS = existsSync(resolve(process.cwd(), '../../app/eventyay/static/fonts'))
  ? resolve(process.cwd(), '../../app/eventyay/static/fonts')
  : resolve(process.cwd(), '../eventyay/app/eventyay/static/fonts')

function fontAsset(filename) {
  const path = resolve(EVENTYAY_FONTS, filename)
  if (!existsSync(path)) {
    return null
  }
  return readFileSync(path).toString('base64')
}

const multilingualPrintAssets = {
  regular: fontAsset('OpenSans-Regular.ttf'),
  bold: fontAsset('OpenSans-Bold.ttf'),
  and: fontAsset('AND-Regular.ttf'),
  arabic: fontAsset('NotoNaskhArabic-Regular.ttf'),
  arabicBold: fontAsset('NotoNaskhArabic-Bold.ttf'),
  devanagari: fontAsset('NotoSansDevanagari-Regular.ttf'),
  devanagariBold: fontAsset('NotoSansDevanagari-Bold.ttf'),
  cjk: fontAsset('NotoSansSC-Regular.ttf'),
  korean: fontAsset('NotoSansKR-Regular.ttf'),
  thai: fontAsset('NotoSansThai-Regular.ttf'),
  hebrew: fontAsset('NotoSansHebrew-Regular.ttf'),
  fallback: fontAsset('DroidSansFallbackFull.ttf')
}
const hasServerFonts = Object.values(multilingualPrintAssets).every(Boolean)

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
      layout: [
        {
          type: 'imagearea',
          content: 'question_photo',
          left: '10',
          bottom: '10',
          width: '30',
          height: '40'
        }
      ]
    }
    expect(layoutRequiresOnlineGeneration(withImage)).toBe(true)
    expect(canRenderBadgeLocally(withImage)).toBe(false)
    expect(
      layoutRequiresOnlineGeneration({ layout: [{ type: 'poweredby', content: 'dark' }] })
    ).toBe(false)
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

  it('syncs the same static font and powered-by paths the server PDF renderer uses', () => {
    expect(PRINT_ASSET_PATHS).toMatchObject({
      regular: '/static/fonts/OpenSans-Regular.ttf',
      bold: '/static/fonts/OpenSans-Bold.ttf',
      italic: '/static/fonts/OpenSans-Italic.ttf',
      boldItalic: '/static/fonts/OpenSans-BoldItalic.ttf',
      and: '/static/fonts/AND-Regular.ttf',
      arabic: '/static/fonts/NotoNaskhArabic-Regular.ttf',
      arabicBold: '/static/fonts/NotoNaskhArabic-Bold.ttf',
      devanagari: '/static/fonts/NotoSansDevanagari-Regular.ttf',
      devanagariBold: '/static/fonts/NotoSansDevanagari-Bold.ttf',
      cjk: '/static/fonts/NotoSansCJKsc-Regular.otf',
      thai: '/static/fonts/NotoSansThai-Regular.ttf',
      hebrew: '/static/fonts/NotoSansHebrew-Regular.ttf',
      fallback: '/static/fonts/DroidSansFallbackFull.ttf',
      poweredByDark: '/static/pretixpresale/pdf/powered_by_eventyay_dark.png',
      poweredByWhite: '/static/pretixpresale/pdf/powered_by_eventyay_white.png'
    })
  })

  it('splits mixed-script badge text into font runs including CJK, Thai, and Hebrew', () => {
    const runs = splitScriptRuns('Ada مرحبا नमस्ते 你好 สวัสดี שָׁלוֹם')
    expect(runs.map((run) => run.script)).toEqual([
      'latin',
      'arabic',
      'latin',
      'devanagari',
      'latin',
      'cjk',
      'latin',
      'thai',
      'latin',
      'hebrew'
    ])
  })

  it.skipIf(!hasServerFonts)(
    'embeds Open Sans, Noto CJK, Korean, Thai, and Hebrew fonts for all languages and dialects',
    async () => {
      const multilingualNames = [
        'Ada Lovelace',
        'Jürgen Müller-Straße',
        'José María González',
        'مرحبا بك في إيفينتياي',
        'नमस्ते एंटीग्रेविटी',
        '山田太郎 こんにちは カタカナ',
        '홍길동 안녕하세요',
        '张伟 欢迎参加',
        '張偉 歡迎參加',
        'สมชาย สวัสดีครับ',
        'שָׁלוֹם וברכה',
        'Ada مرحبا नमस्ते 山田太郎 홍길동 张伟 สมชาย שָׁלוֹם'
      ]

      for (const name of multilingualNames) {
        const blob = await renderBadgePdfFromLayout({
          layout: {
            size: [{ width: 148, height: 105, orientation: 'landscape' }],
            layout: [
              {
                type: 'textarea',
                left: '8',
                bottom: '80',
                fontsize: '14',
                color: [0, 0, 0, 1],
                width: '130',
                content: 'attendee_name',
                align: 'left'
              }
            ]
          },
          pdfData: { attendee_name: name },
          printAssets: multilingualPrintAssets
        })
        expect(blob.size).toBeGreaterThan(1000)
      }
    }
  )

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
