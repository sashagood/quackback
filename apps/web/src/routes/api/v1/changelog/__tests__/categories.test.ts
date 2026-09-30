import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockWithApiKeyAuth = vi.fn()
const mockListChangelogCategories = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...args: unknown[]) => mockWithApiKeyAuth(...args),
}))
vi.mock('@/lib/server/domains/changelog/changelog-category.service', () => ({
  listChangelogCategories: (...args: unknown[]) => mockListChangelogCategories(...args),
}))

import { PERMISSIONS } from '@/lib/shared/permissions'
import { Route } from '../categories'

type Handlers = { GET: (args: { request: Request }) => Promise<Response> }
type RouteOpts = { server: { handlers: Handlers } }
const { GET } = (Route as unknown as { options: RouteOpts }).options.server.handlers

const NIGHTLY = {
  id: 'changelog_category_01h455vb4pex5vsknk084sn02q',
  name: 'Nightly',
  color: '#6b7280',
  segmentIds: ['segment_01h455vb4pex5vsknk084sn02q'],
  position: 0,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
}
const ALPHA = {
  ...NIGHTLY,
  id: 'changelog_category_01h455vb4pex5vsknk084sn02r',
  name: 'Alpha',
  position: 1,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockWithApiKeyAuth.mockResolvedValue({ principalId: 'principal_x', role: 'team' })
  mockListChangelogCategories.mockResolvedValue([NIGHTLY, ALPHA])
})

describe('GET /api/v1/changelog/categories', () => {
  it('lists labels with id, name, color, and position only', async () => {
    const res = await GET({ request: new Request('http://t/api/v1/changelog/categories') })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toEqual([
      { id: NIGHTLY.id, name: 'Nightly', color: '#6b7280', position: 0 },
      { id: ALPHA.id, name: 'Alpha', color: '#6b7280', position: 1 },
    ])
  })

  it('gates on the same permission as listing entries', async () => {
    await GET({ request: new Request('http://t/api/v1/changelog/categories') })

    expect(mockWithApiKeyAuth).toHaveBeenCalledWith(expect.any(Request), {
      permission: PERMISSIONS.CHANGELOG_VIEW_DRAFT,
    })
  })

  it('returns 401 when the API key check fails', async () => {
    const { UnauthorizedError } = await import('@/lib/shared/errors')
    mockWithApiKeyAuth.mockRejectedValue(new UnauthorizedError('UNAUTHORIZED', 'Invalid API key'))

    const res = await GET({ request: new Request('http://t/api/v1/changelog/categories') })

    expect(res.status).toBe(401)
    expect(mockListChangelogCategories).not.toHaveBeenCalled()
  })
})
