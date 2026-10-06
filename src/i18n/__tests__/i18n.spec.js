import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setLocale, getCurrentLocale, t } from '@/i18n'
import {
  SUPPORTED_LOCALES,
  TRANSLATED_LOCALES,
  DEFAULT_LOCALE,
  isRtlLocale,
  getLocaleMetadata
} from '@/i18n/locales'

describe('i18n infrastructure', () => {
  beforeEach(() => {
    localStorage.clear()
    setLocale('en')
  })

  afterEach(() => {
    setLocale('en')
    localStorage.clear()
  })

  it('supports all 49 Weblate locales with proper metadata', () => {
    expect(SUPPORTED_LOCALES.length).toBe(49)
    expect(TRANSLATED_LOCALES.length).toBe(12)
    expect(DEFAULT_LOCALE).toBe('en')

    const codes = SUPPORTED_LOCALES.map((l) => l.code)
    expect(codes).toContain('vi')
    expect(codes).toContain('th')
    expect(codes).toContain('zh_Hans')
    expect(codes).toContain('pt_BR')
    expect(codes).toContain('ar')
  })

  it('identifies Arabic (ar), Persian (fa), and Urdu (ur) as RTL and others as LTR', () => {
    expect(isRtlLocale('ar')).toBe(true)
    expect(isRtlLocale('fa')).toBe(true)
    expect(isRtlLocale('ur')).toBe(true)
    expect(isRtlLocale('en')).toBe(false)
    expect(isRtlLocale('es')).toBe(false)
    expect(isRtlLocale('vi')).toBe(false)
    expect(isRtlLocale('th')).toBe(false)

    const arMeta = getLocaleMetadata('ar')
    expect(arMeta.dir).toBe('rtl')
    expect(arMeta.name).toBe('Arabic')
    expect(arMeta.nativeName).toBe('العربية')
  })

  it('translates keys with t() helper and switches locale reactively', () => {
    setLocale('en')
    expect(t('common.save')).toBe('Save')
    expect(t('common.cancel')).toBe('Cancel')

    // Vietnamese verification
    setLocale('vi')
    expect(getCurrentLocale()).toBe('vi')
    expect(t('common.save')).toBe('Lưu')
    expect(t('common.cancel')).toBe('Hủy')

    // Thai verification
    setLocale('th')
    expect(getCurrentLocale()).toBe('th')
    expect(t('common.save')).toBe('บันทึก')
    expect(t('common.cancel')).toBe('ยกเลิก')

    // Spanish verification
    setLocale('es')
    expect(getCurrentLocale()).toBe('es')
    expect(t('common.save')).toBe('Guardar')
    expect(t('common.cancel')).toBe('Cancelar')

    // German verification
    setLocale('de')
    expect(getCurrentLocale()).toBe('de')
    expect(t('common.save')).toBe('Speichern')

    // Hindi verification
    setLocale('hi')
    expect(getCurrentLocale()).toBe('hi')
    expect(t('common.save')).toBe('सहेजें')

    // Simplified Chinese
    setLocale('zh_Hans')
    expect(getCurrentLocale()).toBe('zh_Hans')
    expect(t('common.save')).toBe('保存')

    // Russian
    setLocale('ru')
    expect(getCurrentLocale()).toBe('ru')
    expect(t('common.save')).toBe('Сохранить')
  })

  it('handles legacy code aliases (zh -> zh_Hans, pt -> pt_BR)', () => {
    setLocale('zh')
    expect(getCurrentLocale()).toBe('zh_Hans')
    expect(t('common.save')).toBe('保存')

    setLocale('pt')
    expect(getCurrentLocale()).toBe('pt_BR')
    expect(t('common.save')).toBe('Salvar')
  })

  it('correctly sets document language and direction attribute for RTL', () => {
    setLocale('ar')
    expect(document.documentElement.dir).toBe('rtl')
    expect(document.documentElement.lang).toBe('ar')

    setLocale('en')
    expect(document.documentElement.dir).toBe('ltr')
    expect(document.documentElement.lang).toBe('en')
  })

  it('persists selected locale to localStorage', () => {
    setLocale('vi')
    expect(localStorage.getItem('eventyay_locale')).toBe('vi')
    expect(getCurrentLocale()).toBe('vi')
  })

  it('handles interpolation parameters correctly', () => {
    setLocale('en')
    expect(t('common.page_of', { current: 2, total: 10 })).toBe('Page 2 of 10')

    setLocale('es')
    expect(t('common.page_of', { current: 2, total: 10 })).toBe('Página 2 de 10')

    setLocale('vi')
    expect(t('common.page_of', { current: 2, total: 10 })).toBe('Trang 2 trên 10')

    setLocale('th')
    expect(t('common.page_of', { current: 2, total: 10 })).toBe('หน้า 2 จาก 10')
  })
})
