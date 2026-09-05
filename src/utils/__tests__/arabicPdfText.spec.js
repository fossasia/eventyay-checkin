import { shapeArabicForPdf } from '@/utils/arabicPdfText'
import { describe, expect, it } from 'vitest'

describe('shapeArabicForPdf', () => {
  it('leaves Latin text unchanged', () => {
    expect(shapeArabicForPdf('Ada Lovelace')).toBe('Ada Lovelace')
  })

  it('reshapes Arabic into joined presentation forms and visual order', () => {
    const logical = 'مرحبا'
    const shaped = shapeArabicForPdf(logical)
    expect(shaped).not.toBe(logical)
    expect(shaped).toMatch(/[\uFB50-\uFDFF\uFE70-\uFEFF]/)
    expect(shaped.charCodeAt(0)).not.toBe(logical.charCodeAt(0))
  })

  it('keeps Latin around reshaped Arabic on mixed lines', () => {
    const shaped = shapeArabicForPdf('Ada مرحبا')
    expect(shaped.startsWith('Ada')).toBe(true)
    expect(shaped).toMatch(/[\uFB50-\uFDFF\uFE70-\uFEFF]/)
  })

  it('strips harakat like the server reshaper', () => {
    expect(shapeArabicForPdf('مَرْحَبًا')).not.toMatch(/[\u064B-\u065F]/)
  })
})
