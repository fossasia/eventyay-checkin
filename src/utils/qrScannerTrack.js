/** QR highlight — no Vue reactivity in this callback. */
const BOX_DETECTED = 'rgba(80, 161, 103, 0.95)'

export function paintQrScannerTrack(detectedCodes, ctx) {
  if (!detectedCodes?.length) {
    return
  }

  for (const detected of detectedCodes) {
    const { x, y, width, height } = detected.boundingBox
    ctx.lineWidth = 2.5
    ctx.strokeStyle = BOX_DETECTED
    ctx.strokeRect(x, y, width, height)
  }
}
