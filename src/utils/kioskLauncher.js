export function buildKioskUrl(origin, fullPath) {
  const basePath = fullPath.split('?')[0]
  const params = new URLSearchParams(fullPath.includes('?') ? fullPath.split('?')[1] : '')
  params.set('kiosk', 'true')
  const query = params.toString()
  return `${origin}${basePath}${query ? `?${query}` : ''}`
}

/**
 * Kiosk mode is signaled explicitly via ?kiosk=true (included in the terminal launcher commands).
 * Do not guess from window size — maximized browsers look like kiosk and break the navbar.
 */
export function isKioskEnvironment(route = null) {
  if (typeof window === 'undefined') {
    return false
  }
  if (route?.query?.kiosk === 'true') {
    return true
  }
  return new URLSearchParams(window.location.search).get('kiosk') === 'true'
}

/** Silent iframe printing works in kiosk mode (?kiosk=true). */
export function shouldUseSilentPrint(route = null) {
  return isKioskEnvironment(route)
}

export function detectPlatform() {
  if (typeof navigator === 'undefined') {
    return 'unknown'
  }
  const ua = navigator.userAgent.toLowerCase()
  const platform = navigator.platform?.toLowerCase() || ''

  if (ua.includes('android')) {
    return 'android'
  }
  if (
    ua.includes('ipad') ||
    ua.includes('iphone') ||
    ua.includes('ipod') ||
    (platform.includes('mac') && navigator.maxTouchPoints > 1)
  ) {
    return 'ios'
  }
  if (platform.includes('mac') || ua.includes('mac os')) {
    return 'mac'
  }
  if (platform.includes('win') || ua.includes('windows')) {
    return 'windows'
  }
  if (platform.includes('linux') || ua.includes('linux')) {
    return 'linux'
  }
  return 'unknown'
}

export function isMobileOrTablet(platform = detectPlatform()) {
  if (platform === 'android' || platform === 'ios') {
    return true
  }
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent.toLowerCase()
    if (ua.includes('android') || ua.includes('ipad') || ua.includes('iphone') || ua.includes('mobile')) {
      return true
    }
  }
  return false
}

export function getPlatformLabel(platform = detectPlatform()) {
  if (platform === 'mac') {
    return 'macOS'
  }
  if (platform === 'windows') {
    return 'Windows'
  }
  if (platform === 'linux') {
    return 'Linux'
  }
  if (platform === 'android') {
    return 'Android Tablet'
  }
  if (platform === 'ios') {
    return 'iPadOS / iOS'
  }
  return 'Unknown'
}

export function getShellLabel(platform = detectPlatform()) {
  if (platform === 'windows') {
    return 'Command Prompt or PowerShell'
  }
  return 'Terminal'
}

export function getKioskInfo(route = null) {
  const isKiosk = isKioskEnvironment(route)
  const platform = detectPlatform()
  const mobileTablet = isMobileOrTablet(platform)

  return {
    isKiosk,
    isMobileOrTablet: mobileTablet,
    platform,
    platformLabel: getPlatformLabel(platform),
    shellLabel: getShellLabel(platform),
    supportsDesktopFlags: !mobileTablet && (platform === 'mac' || platform === 'windows' || platform === 'linux')
  }
}

export function buildChromeKioskCommand(url, platform = detectPlatform()) {
  if (platform === 'windows') {
    return `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --kiosk --kiosk-printing "${url}"`
  }
  if (platform === 'mac') {
    return `/Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --kiosk --kiosk-printing '${url}'`
  }
  return `google-chrome --kiosk --kiosk-printing '${url}'`
}

export function buildFirefoxKioskCommand(url, platform = detectPlatform()) {
  const flags = '-kiosk -pref "print.always_print_silent,true"'

  if (platform === 'windows') {
    return `"C:\\Program Files\\Mozilla Firefox\\firefox.exe" ${flags} "${url}"`
  }
  if (platform === 'mac') {
    return `/Applications/Firefox.app/Contents/MacOS/firefox ${flags} '${url}'`
  }
  return `firefox ${flags} '${url}'`
}

export async function enterKioskShell() {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
    }
  } catch {
    // Fullscreen may require a user gesture on some browsers.
  }
}

