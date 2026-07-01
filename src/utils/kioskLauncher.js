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
  return route?.query?.kiosk === 'true'
}

export function detectPlatform() {
  const ua = navigator.userAgent.toLowerCase()
  const platform = navigator.platform?.toLowerCase() || ''

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
  return 'Unknown'
}

export function getShellLabel(platform = detectPlatform()) {
  if (platform === 'windows') {
    return 'Command Prompt or PowerShell'
  }
  return 'Terminal'
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
