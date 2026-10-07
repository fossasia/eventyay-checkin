import { PRINT_ASSET_PATHS, syncBadgePrintAssets } from '@/offline/badgePrintAssets'
import { createMemoryIndex } from '@/offline/memoryIndex'
import { createEmptySnapshot, mergeLayoutsIntoSnapshot } from '@/offline/normalize'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllGlobals())

function refreshedLayout(background) {
  const snapshot = createEmptySnapshot('org', 'event')
  mergeLayoutsIntoSnapshot(snapshot, [
    { id: 7, layout: '[]', background: '/old.pdf', backgroundPdf: 'old-pdf-bytes' }
  ])
  mergeLayoutsIntoSnapshot(snapshot, [{ id: 7, layout: '[]', background }])
  return createMemoryIndex(snapshot).layouts.get('7')
}

describe('offline badge background refresh', () => {
  it('drops cached PDF bytes when the background URL changes', () => {
    const layout = refreshedLayout('/new.pdf')
    expect(layout.background).toBe('/new.pdf')
    expect(layout.backgroundPdf).toBeNull()
  })

  it('drops cached PDF bytes when the background is removed', () => {
    const layout = refreshedLayout(null)
    expect(layout.background).toBeNull()
    expect(layout.backgroundPdf).toBeNull()
  })

  it('keeps cached bytes when the background URL has not changed', () => {
    expect(refreshedLayout('/old.pdf').backgroundPdf).toBe('old-pdf-bytes')
  })

  it('prefers replacement PDF bytes supplied with refreshed metadata', () => {
    const snapshot = createEmptySnapshot('org', 'event')
    mergeLayoutsIntoSnapshot(snapshot, [
      { id: 7, layout: '[]', background: '/old.pdf', backgroundPdf: 'old' }
    ])
    mergeLayoutsIntoSnapshot(snapshot, [
      { id: 7, layout: '[]', background: '/new.pdf', backgroundPdf: 'new' }
    ])
    expect(snapshot.layouts['7'].backgroundPdf).toBe('new')
  })
  it('fetches replacement background bytes after a layout refresh', async () => {
    const layout = refreshedLayout('/new.pdf')
    const index = createMemoryIndex(createEmptySnapshot('org', 'event'))
    index.layouts.set('7', layout)
    index.printAssets = Object.fromEntries(
      Object.keys(PRINT_ASSET_PATHS).map((key) => [key, 'cached-font'])
    )
    const fetchMock = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode('new-pdf').buffer
      })
    vi.stubGlobal('fetch', fetchMock)
    await syncBadgePrintAssets(index, {
      url: 'https://tickets.test',
      apitoken: 'device-token',
      organizer: 'org',
      eventSlug: 'event'
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://tickets.test/api/v1/organizers/org/events/event/badgelayouts/7/background/'
    )
    expect(index.layouts.get('7').backgroundPdf).toBe(btoa('new-pdf'))
  })
})
