function waitForWindowLoad() {
  if (document.readyState === 'complete') {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    window.addEventListener('load', resolve, { once: true })
  })
}

function waitForFonts() {
  if (document.fonts?.ready) {
    return document.fonts.ready
  }
  return Promise.resolve()
}

function waitForStylesheets() {
  const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
  const pending = links
    .filter((link) => !link.sheet)
    .map(
      (link) =>
        new Promise((resolve) => {
          link.addEventListener('load', resolve, { once: true })
          link.addEventListener('error', resolve, { once: true })
        })
    )

  if (!pending.length) {
    return Promise.resolve()
  }

  return Promise.all(pending)
}

export function waitForDesignAssets() {
  return Promise.all([waitForWindowLoad(), waitForFonts(), waitForStylesheets()])
}
