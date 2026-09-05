import { ArabicShaper } from 'arabic-persian-reshaper'
import bidiFactory from 'bidi-js'

const bidi = bidiFactory()

const ARABIC_ANY = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/
const HARAKAT = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g

function visualOrder(text) {
  const embeddingLevels = bidi.getEmbeddingLevels(text)
  const chars = text.split('')
  const mirrored = bidi.getMirroredCharactersMap(text, embeddingLevels)
  for (const [index, mirrorChar] of mirrored) {
    chars[index] = mirrorChar
  }
  for (const [start, end] of bidi.getReorderSegments(text, embeddingLevels)) {
    const reversed = chars.slice(start, end + 1).reverse()
    chars.splice(start, end - start + 1, ...reversed)
  }
  return chars.join('')
}

/**
 * Match the server PDF path: ArabicReshaper(delete_harakat, no ligatures)
 * then python-bidi get_display so pdf-lib can draw left-to-right.
 */
export function shapeArabicForPdf(text) {
  const source = String(text || '')
  if (!source || !ARABIC_ANY.test(source)) {
    return source
  }
  return source
    .split('\n')
    .map((line) => {
      try {
        const stripped = line.replace(HARAKAT, '')
        return visualOrder(ArabicShaper.convertArabic(stripped))
      } catch (error) {
        console.warn('Could not reshape Arabic badge text', error)
        return line
      }
    })
    .join('\n')
}
