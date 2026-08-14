import {
  CUSTOM_ORIGIN_WEBSITE,
  DEFAULT_ORIGIN_WEBSITE,
  resolveOriginWebsite
} from '@/utils/originWebsites'
import { describe, expect, it } from 'vitest'

describe('resolveOriginWebsite', () => {
  it('returns the selected origin website', () => {
    expect(resolveOriginWebsite(DEFAULT_ORIGIN_WEBSITE)).toBe(DEFAULT_ORIGIN_WEBSITE)
  })

  it('returns the custom URL when custom is selected', () => {
    expect(resolveOriginWebsite(CUSTOM_ORIGIN_WEBSITE, ' https://local.test/ ')).toBe(
      'https://local.test/'
    )
  })

  it('returns an empty string when custom is selected without a URL', () => {
    expect(resolveOriginWebsite(CUSTOM_ORIGIN_WEBSITE, '  ')).toBe('')
  })
})
