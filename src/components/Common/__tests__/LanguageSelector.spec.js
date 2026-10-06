import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import LanguageSelector from '@/components/Common/LanguageSelector.vue'
import i18n, { setLocale, getCurrentLocale } from '@/i18n'

describe('LanguageSelector.vue', () => {
  beforeEach(() => {
    localStorage.clear()
    setLocale('en')
  })

  afterEach(() => {
    setLocale('en')
    localStorage.clear()
  })

  it('renders language selector button with active language', () => {
    const wrapper = mount(LanguageSelector, {
      global: {
        plugins: [i18n]
      }
    })

    const button = wrapper.find('button')
    expect(button.exists()).toBe(true)
    expect(button.text()).toContain('English')
  })

  it('opens dropdown and changes locale when another language option is clicked', async () => {
    const wrapper = mount(LanguageSelector, {
      global: {
        plugins: [i18n]
      }
    })

    // Open dropdown
    const trigger = wrapper.find('button')
    await trigger.trigger('click')

    // Find Vietnamese option and click it
    const options = wrapper.findAll('button')
    const viOption = options.find((opt) => opt.text().includes('Tiếng Việt'))
    expect(viOption).toBeDefined()

    await viOption.trigger('click')
    expect(getCurrentLocale()).toBe('vi')
  })

  it('filters languages by search query', async () => {
    const wrapper = mount(LanguageSelector, {
      global: {
        plugins: [i18n]
      }
    })

    // Open dropdown
    const trigger = wrapper.find('button')
    await trigger.trigger('click')

    const searchInput = wrapper.find('input[type="search"]')
    expect(searchInput.exists()).toBe(true)

    await searchInput.setValue('thai')
    const buttons = wrapper.findAll('button')
    const thOption = buttons.find((opt) => opt.text().includes('ไทย'))
    expect(thOption).toBeDefined()
  })

  it('toggles between Translated and All tabs', async () => {
    const wrapper = mount(LanguageSelector, {
      global: {
        plugins: [i18n]
      }
    })

    const trigger = wrapper.find('button')
    await trigger.trigger('click')

    const allTab = wrapper.findAll('button').find((b) => b.text().includes('All (49)'))
    expect(allTab).toBeDefined()
    await allTab.trigger('click')

    // Should now show locales from all 49 including e.g. Bengali
    const bnOption = wrapper.findAll('button').find((b) => b.text().includes('বাংলা'))
    expect(bnOption).toBeDefined()
  })
})
