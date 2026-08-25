import {
  buildChromeKioskCommand,
  buildFirefoxKioskCommand,
  buildKioskUrl,
  detectPlatform,
  getKioskInfo,
  getPlatformLabel,
  getShellLabel,
  isKioskEnvironment,
  isMobileOrTablet,
  shouldUseSilentPrint
} from '@/utils/kioskLauncher'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('kioskLauncher utils', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('buildKioskUrl', () => {
    it('appends kiosk=true query param to a url', () => {
      expect(buildKioskUrl('https://checkin.example.com', '/events/demo')).toBe(
        'https://checkin.example.com/events/demo?kiosk=true'
      )
    })

    it('preserves existing query params when appending kiosk=true', () => {
      expect(buildKioskUrl('https://checkin.example.com', '/events/demo?role=badge')).toBe(
        'https://checkin.example.com/events/demo?role=badge&kiosk=true'
      )
    })
  })

  describe('isKioskEnvironment and shouldUseSilentPrint', () => {
    it('returns true when route query has kiosk=true', () => {
      const mockRoute = { query: { kiosk: 'true' } }
      expect(isKioskEnvironment(mockRoute)).toBe(true)
      expect(shouldUseSilentPrint(mockRoute)).toBe(true)
    })

    it('returns false when kiosk param is missing', () => {
      const mockRoute = { query: {} }
      expect(isKioskEnvironment(mockRoute)).toBe(false)
      expect(shouldUseSilentPrint(mockRoute)).toBe(false)
    })
  })

  describe('detectPlatform and isMobileOrTablet', () => {
    it('detects android from user agent', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Linux; Android 13; Tablet) AppleWebKit/537.36',
        platform: 'Linux armv8l',
        maxTouchPoints: 5
      })
      expect(detectPlatform()).toBe('android')
      expect(isMobileOrTablet()).toBe(true)
      expect(getPlatformLabel()).toBe('Android Tablet')
    })

    it('detects iPadOS/iOS from user agent and touch points', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        platform: 'MacIntel',
        maxTouchPoints: 5
      })
      expect(detectPlatform()).toBe('ios')
      expect(isMobileOrTablet()).toBe(true)
      expect(getPlatformLabel()).toBe('iPadOS / iOS')
    })

    it('detects desktop mac', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        platform: 'MacIntel',
        maxTouchPoints: 0
      })
      expect(detectPlatform()).toBe('mac')
      expect(isMobileOrTablet()).toBe(false)
      expect(getPlatformLabel()).toBe('macOS')
    })

    it('detects windows', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        platform: 'Win32',
        maxTouchPoints: 0
      })
      expect(detectPlatform()).toBe('windows')
      expect(isMobileOrTablet()).toBe(false)
      expect(getPlatformLabel()).toBe('Windows')
      expect(getShellLabel()).toBe('Command Prompt or PowerShell')
    })
  })

  describe('getKioskInfo', () => {
    it('returns complete kiosk state for desktop environment', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        platform: 'MacIntel',
        maxTouchPoints: 0
      })
      const route = { query: { kiosk: 'true' } }
      const info = getKioskInfo(route)
      expect(info.isKiosk).toBe(true)
      expect(info.isMobileOrTablet).toBe(false)
      expect(info.platform).toBe('mac')
      expect(info.supportsDesktopFlags).toBe(true)
    })

    it('returns complete kiosk state for mobile/tablet environment', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Linux; Android 13; Tablet)',
        platform: 'Linux armv8l',
        maxTouchPoints: 5
      })
      const route = { query: { kiosk: 'true' } }
      const info = getKioskInfo(route)
      expect(info.isKiosk).toBe(true)
      expect(info.isMobileOrTablet).toBe(true)
      expect(info.platform).toBe('android')
      expect(info.supportsDesktopFlags).toBe(false)
    })
  })

  describe('buildChromeKioskCommand and buildFirefoxKioskCommand', () => {
    it('builds chrome kiosk commands for windows', () => {
      const cmd = buildChromeKioskCommand('https://test.com/?kiosk=true', 'windows')
      expect(cmd).toContain('chrome.exe')
      expect(cmd).toContain('--kiosk-printing')
    })

    it('builds firefox kiosk commands for mac', () => {
      const cmd = buildFirefoxKioskCommand('https://test.com/?kiosk=true', 'mac')
      expect(cmd).toContain('/Applications/Firefox.app')
      expect(cmd).toContain('print.always_print_silent,true')
    })
  })
})
