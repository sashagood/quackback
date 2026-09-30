import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChangelogId } from '@quackback/ids'

const mockWithApiKeyAuth = vi.fn()
const mockGetChangelogById = vi.fn()
const mockUpdateChangelog = vi.fn()
const mockResolveCategoryRefs = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...args: unknown[]) => mockWithApiKeyAuth(...args),
}))
vi.mock('@/lib/server/domains/changelog/changelog.service', () => ({
  getChangelogById: (...args: unknown[]) => mockGetChangelogById(...args),
  updateChangelog: (...args: unknown[]) => mockUpdateChangelog(...args),
  deleteChangelog: vi.fn(),
}))

vi.mock('@/lib/server/domains/changelog/changelog-category.service', () => ({
  resolveChangelogCategoryRefs: (...args: unknown[]) => mockResolveCategoryRefs(...args),
}))

// markdown-tiptap is intentionally NOT mocked — the point of these tests is the
// real contentJson -> markdown serialization, including image nodes.

import { Route } from '../$entryId'

type Handlers = {
  GET: (args: { request: Request; params: { entryId: string } }) => Promise<Response>
  PATCH: (args: { request: Request; params: { entryId: string } }) => Promise<Response>
}
type RouteOpts = { server: { handlers: Handlers } }
const { GET, PATCH } = (Route as unknown as { options: RouteOpts }).options.server.handlers

const ENTRY_ID = 'changelog_01h455vb4pex5vsknk084sn02q' as unknown as ChangelogId
const POST_A = 'post_01h455vb4pex5vsknk084sn02q'
const POST_B = 'post_01h455vb4pex5vsknk084sn02r'
const NIGHTLY_ID = 'changelog_category_01h455vb4pex5vsknk084sn02q'
const ALPHA_ID = 'changelog_category_01h455vb4pex5vsknk084sn02r'
const NIGHTLY = { id: NIGHTLY_ID, name: 'Nightly', color: '#6b7280' }
const ALPHA = { id: ALPHA_ID, name: 'Alpha', color: '#22c55e' }

function linkedPost(id: string, title: string) {
  return {
    id,
    title,
    voteCount: 4,
    status: { name: 'Shipped', color: '#22c55e' },
  }
}

function baseEntry() {
  return {
    id: ENTRY_ID,
    title: 'Dark mode',
    content: 'We shipped dark mode.',
    contentJson: null as unknown,
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    displayDate: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    linkedPosts: [] as ReturnType<typeof linkedPost>[],
    categories: [] as Array<{ id: string; name: string; color: string }>,
  }
}

function patchRequest(body: Record<string, unknown>): Request {
  return new Request(`http://t/api/v1/changelog/${ENTRY_ID}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('GET /api/v1/changelog/:entryId — markdown image output', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWithApiKeyAuth.mockResolvedValue({ principalId: 'principal_x', role: 'team' })
  })

  it('renders images from contentJson as markdown that the stored content dropped', async () => {
    mockGetChangelogById.mockResolvedValue({
      ...baseEntry(),
      // Stored markdown column lost the image (client serializer has no spec
      // for the image node); contentJson is the source of truth.
      content: 'We shipped dark mode.',
      contentJson: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'We shipped dark mode.' }] },
          {
            type: 'image',
            attrs: { src: 'https://cdn.example.com/dark.png', alt: 'Dark mode', title: null },
          },
        ],
      },
    })

    const res = await GET({ request: new Request('http://t/'), params: { entryId: ENTRY_ID } })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.content).toContain('We shipped dark mode.')
    expect(json.data.content).toContain('![Dark mode](https://cdn.example.com/dark.png)')
  })

  it('falls back to the stored content for legacy rows without contentJson', async () => {
    mockGetChangelogById.mockResolvedValue({
      ...baseEntry(),
      content: '# Legacy entry\n\nPlain text.',
      contentJson: null,
    })

    const res = await GET({ request: new Request('http://t/'), params: { entryId: ENTRY_ID } })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.content).toBe('# Legacy entry\n\nPlain text.')
  })

  it('includes linked posts on the public API representation', async () => {
    mockGetChangelogById.mockResolvedValue({
      ...baseEntry(),
      linkedPosts: [linkedPost(POST_A, 'Dark mode request')],
    })

    const res = await GET({ request: new Request('http://t/'), params: { entryId: ENTRY_ID } })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.linkedPosts).toEqual([linkedPost(POST_A, 'Dark mode request')])
  })
})

describe('PATCH /api/v1/changelog/:entryId — linkedPostIds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWithApiKeyAuth.mockResolvedValue({ principalId: 'principal_x', role: 'team' })
    mockUpdateChangelog.mockResolvedValue({
      ...baseEntry(),
      linkedPosts: [linkedPost(POST_A, 'Dark mode request'), linkedPost(POST_B, 'Theme picker')],
    })
  })

  it('forwards linkedPostIds to updateChangelog', async () => {
    const res = await PATCH({
      request: patchRequest({ linkedPostIds: [POST_A, POST_B] }),
      params: { entryId: ENTRY_ID },
    })

    expect(res.status).toBe(200)
    expect(mockUpdateChangelog).toHaveBeenCalledTimes(1)
    expect(mockUpdateChangelog.mock.calls[0][1]).toMatchObject({
      linkedPostIds: [POST_A, POST_B],
    })
  })

  it('forwards an empty linkedPostIds array so existing links can be cleared', async () => {
    mockUpdateChangelog.mockResolvedValue(baseEntry())

    const res = await PATCH({
      request: patchRequest({ linkedPostIds: [] }),
      params: { entryId: ENTRY_ID },
    })

    expect(res.status).toBe(200)
    expect(mockUpdateChangelog.mock.calls[0][1]).toMatchObject({ linkedPostIds: [] })
  })

  it('does not send linkedPostIds when the field is omitted', async () => {
    const res = await PATCH({
      request: patchRequest({ title: 'Renamed' }),
      params: { entryId: ENTRY_ID },
    })

    expect(res.status).toBe(200)
    const input = mockUpdateChangelog.mock.calls[0][1] as Record<string, unknown>
    expect(input).not.toHaveProperty('linkedPostIds')
  })

  it('echoes linked posts on the update response', async () => {
    const res = await PATCH({
      request: patchRequest({ linkedPostIds: [POST_A, POST_B] }),
      params: { entryId: ENTRY_ID },
    })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.linkedPosts).toEqual([
      linkedPost(POST_A, 'Dark mode request'),
      linkedPost(POST_B, 'Theme picker'),
    ])
  })

  it('rejects a malformed linkedPostId without calling updateChangelog', async () => {
    const res = await PATCH({
      request: patchRequest({ linkedPostIds: ['not-a-post'] }),
      params: { entryId: ENTRY_ID },
    })

    expect(res.status).toBe(400)
    expect(mockUpdateChangelog).not.toHaveBeenCalled()
  })

  it('rejects a wrong-prefix TypeID without calling updateChangelog', async () => {
    const res = await PATCH({
      request: patchRequest({ linkedPostIds: [ENTRY_ID] }),
      params: { entryId: ENTRY_ID },
    })

    expect(res.status).toBe(400)
    expect(mockUpdateChangelog).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/changelog/:entryId — categories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWithApiKeyAuth.mockResolvedValue({ principalId: 'principal_x', role: 'team' })
  })

  it('includes categories on the public API representation', async () => {
    mockGetChangelogById.mockResolvedValue({ ...baseEntry(), categories: [NIGHTLY, ALPHA] })

    const res = await GET({ request: new Request('http://t/'), params: { entryId: ENTRY_ID } })
    const json = await res.json()
    expect(json.data.categories).toEqual([NIGHTLY, ALPHA])
  })
})

describe('PATCH /api/v1/changelog/:entryId — categories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWithApiKeyAuth.mockResolvedValue({ principalId: 'principal_x', role: 'team' })
    mockResolveCategoryRefs.mockResolvedValue([ALPHA_ID])
    mockUpdateChangelog.mockResolvedValue({ ...baseEntry(), categories: [ALPHA] })
  })

  it('resolves category refs and forwards the ids to updateChangelog', async () => {
    const res = await PATCH({
      request: patchRequest({ categories: [ALPHA_ID] }),
      params: { entryId: ENTRY_ID },
    })

    expect(res.status).toBe(200)
    expect(mockResolveCategoryRefs).toHaveBeenCalledWith([ALPHA_ID])
    expect(mockUpdateChangelog.mock.calls[0][1]).toMatchObject({ categoryIds: [ALPHA_ID] })
    const json = await res.json()
    expect(json.data.categories).toEqual([ALPHA])
  })

  it('forwards an empty list so existing categories can be cleared', async () => {
    mockResolveCategoryRefs.mockResolvedValue([])
    mockUpdateChangelog.mockResolvedValue(baseEntry())

    const res = await PATCH({
      request: patchRequest({ categories: [] }),
      params: { entryId: ENTRY_ID },
    })

    expect(res.status).toBe(200)
    expect(mockUpdateChangelog.mock.calls[0][1]).toMatchObject({ categoryIds: [] })
  })

  it('does not send categoryIds when the field is omitted', async () => {
    await PATCH({ request: patchRequest({ title: 'Renamed' }), params: { entryId: ENTRY_ID } })

    expect(mockResolveCategoryRefs).not.toHaveBeenCalled()
    const input = mockUpdateChangelog.mock.calls[0][1] as Record<string, unknown>
    expect(input).not.toHaveProperty('categoryIds')
  })

  it('returns 400 naming the unknown category without calling updateChangelog', async () => {
    const { ValidationError } = await import('@/lib/shared/errors')
    mockResolveCategoryRefs.mockRejectedValue(
      new ValidationError('VALIDATION_ERROR', 'Unknown changelog categories: beta')
    )

    const res = await PATCH({
      request: patchRequest({ categories: ['beta'] }),
      params: { entryId: ENTRY_ID },
    })

    expect(res.status).toBe(400)
    expect(await res.text()).toContain('beta')
    expect(mockUpdateChangelog).not.toHaveBeenCalled()
  })
})
