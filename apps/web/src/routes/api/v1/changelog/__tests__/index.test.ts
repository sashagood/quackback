import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockWithApiKeyAuth = vi.fn()
const mockCreateChangelog = vi.fn()
const mockListChangelogs = vi.fn()
const mockPrincipalFindFirst = vi.fn()
const mockResolveCategoryRefs = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...args: unknown[]) => mockWithApiKeyAuth(...args),
}))
vi.mock('@/lib/server/domains/changelog/changelog.service', () => ({
  createChangelog: (...args: unknown[]) => mockCreateChangelog(...args),
}))
vi.mock('@/lib/server/domains/changelog/changelog.query', () => ({
  listChangelogs: (...args: unknown[]) => mockListChangelogs(...args),
}))
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      principal: { findFirst: (...args: unknown[]) => mockPrincipalFindFirst(...args) },
    },
  },
  eq: vi.fn(),
}))

vi.mock('@/lib/server/domains/changelog/changelog-category.service', () => ({
  resolveChangelogCategoryRefs: (...args: unknown[]) => mockResolveCategoryRefs(...args),
}))

import { Route } from '../index'

type Handlers = {
  GET: (args: { request: Request }) => Promise<Response>
  POST: (args: { request: Request }) => Promise<Response>
}
type RouteOpts = { server: { handlers: Handlers } }
const { GET, POST } = (Route as unknown as { options: RouteOpts }).options.server.handlers

const ENTRY_ID = 'changelog_01h455vb4pex5vsknk084sn02q'
const POST_A = 'post_01h455vb4pex5vsknk084sn02q'

const NIGHTLY_ID = 'changelog_category_01h455vb4pex5vsknk084sn02q'
const NIGHTLY = { id: NIGHTLY_ID, name: 'Nightly', color: '#6b7280' }

const LINKED_POST = {
  id: POST_A,
  title: 'Dark mode request',
  voteCount: 4,
  status: { name: 'Shipped', color: '#22c55e' },
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: ENTRY_ID,
    title: 'Dark mode',
    content: 'We shipped dark mode.',
    contentJson: null,
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    displayDate: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    linkedPosts: [LINKED_POST],
    categories: [NIGHTLY],
    ...overrides,
  }
}

function postRequest(body: Record<string, unknown>): Request {
  return new Request('http://t/api/v1/changelog', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockWithApiKeyAuth.mockResolvedValue({ principalId: 'principal_x', role: 'team' })
  mockPrincipalFindFirst.mockResolvedValue({ displayName: 'API' })
  mockCreateChangelog.mockResolvedValue(entry())
  mockResolveCategoryRefs.mockResolvedValue([NIGHTLY_ID])
  mockListChangelogs.mockResolvedValue({
    items: [entry()],
    nextCursor: null,
    hasMore: false,
  })
})

describe('GET /api/v1/changelog — linked posts', () => {
  it('includes linked posts on each listed entry', async () => {
    const res = await GET({ request: new Request('http://t/api/v1/changelog') })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toHaveLength(1)
    expect(json.data[0].linkedPosts).toEqual([LINKED_POST])
  })

  it('returns an empty linkedPosts array when the entry has none', async () => {
    mockListChangelogs.mockResolvedValue({
      items: [entry({ linkedPosts: [] })],
      nextCursor: null,
      hasMore: false,
    })

    const res = await GET({ request: new Request('http://t/api/v1/changelog') })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data[0].linkedPosts).toEqual([])
  })
})

describe('POST /api/v1/changelog — linked posts', () => {
  it('forwards linkedPostIds to createChangelog and echoes linked posts', async () => {
    const res = await POST({
      request: postRequest({
        title: 'Dark mode',
        content: 'We shipped dark mode.',
        linkedPostIds: [POST_A],
      }),
    })

    expect(res.status).toBe(201)
    expect(mockCreateChangelog).toHaveBeenCalledTimes(1)
    expect(mockCreateChangelog.mock.calls[0][0]).toMatchObject({
      title: 'Dark mode',
      linkedPostIds: [POST_A],
    })
    const json = await res.json()
    expect(json.data.linkedPosts).toEqual([LINKED_POST])
  })

  it('rejects a malformed linkedPostId without calling createChangelog', async () => {
    const res = await POST({
      request: postRequest({
        title: 'Dark mode',
        content: 'We shipped dark mode.',
        linkedPostIds: ['not-a-post'],
      }),
    })

    expect(res.status).toBe(400)
    expect(mockCreateChangelog).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/changelog — categories', () => {
  it('includes categories on each listed entry', async () => {
    const res = await GET({ request: new Request('http://t/api/v1/changelog') })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data[0].categories).toEqual([NIGHTLY])
  })

  it('returns an empty categories array when the entry has none', async () => {
    mockListChangelogs.mockResolvedValue({
      items: [entry({ categories: [] })],
      nextCursor: null,
      hasMore: false,
    })
    const res = await GET({ request: new Request('http://t/api/v1/changelog') })
    const json = await res.json()
    expect(json.data[0].categories).toEqual([])
  })
})

describe('POST /api/v1/changelog — categories', () => {
  it('resolves category refs and forwards the ids to createChangelog', async () => {
    const res = await POST({
      request: postRequest({ title: 'Nightly build', content: 'Fixes.', categories: ['nightly'] }),
    })

    expect(res.status).toBe(201)
    expect(mockResolveCategoryRefs).toHaveBeenCalledWith(['nightly'])
    expect(mockCreateChangelog.mock.calls[0][0]).toMatchObject({ categoryIds: [NIGHTLY_ID] })
    const json = await res.json()
    expect(json.data.categories).toEqual([NIGHTLY])
  })

  it('does not resolve or send categoryIds when the field is omitted', async () => {
    await POST({ request: postRequest({ title: 'Nightly build', content: 'Fixes.' }) })

    expect(mockResolveCategoryRefs).not.toHaveBeenCalled()
    const input = mockCreateChangelog.mock.calls[0][0] as Record<string, unknown>
    expect(input).not.toHaveProperty('categoryIds')
  })

  it('returns 400 naming the unknown category and does not create the entry', async () => {
    const { ValidationError } = await import('@/lib/shared/errors')
    mockResolveCategoryRefs.mockRejectedValue(
      new ValidationError('VALIDATION_ERROR', 'Unknown changelog categories: beta')
    )

    const res = await POST({
      request: postRequest({ title: 'Nightly build', content: 'Fixes.', categories: ['beta'] }),
    })

    expect(res.status).toBe(400)
    expect(await res.text()).toContain('beta')
    expect(mockCreateChangelog).not.toHaveBeenCalled()
  })
})
