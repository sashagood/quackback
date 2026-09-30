import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

const mockCreateChangelog = vi.fn()
const mockUpdateChangelog = vi.fn()
const mockResolveCategoryRefs = vi.fn()

vi.mock('@/lib/server/domains/changelog/changelog.service', () => ({
  createChangelog: (...args: unknown[]) => mockCreateChangelog(...args),
  updateChangelog: (...args: unknown[]) => mockUpdateChangelog(...args),
  deleteChangelog: vi.fn(),
}))
vi.mock('@/lib/server/domains/changelog/changelog-category.service', () => ({
  resolveChangelogCategoryRefs: (...args: unknown[]) => mockResolveCategoryRefs(...args),
}))

import { registerChangelogTools } from '../changelog'
import type { McpAuthContext } from '../../types'

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>

function collect(auth: McpAuthContext): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  const fakeServer = {
    tool: (name: string, _d: string, _s: unknown, _a: unknown, handler: Handler) => {
      handlers.set(name, handler)
    },
  }
  registerChangelogTools(fakeServer as never, auth)
  return handlers
}

const teamAuth = {
  principalId: 'principal_james',
  userId: 'user_1',
  name: 'James',
  email: 'james@quackback.io',
  role: 'admin' as const,
  authMethod: 'oauth' as const,
  scopes: ['write:changelog', 'read:feedback'],
} as unknown as McpAuthContext

const NIGHTLY_ID = 'changelog_category_01h455vb4pex5vsknk084sn02q'
const ENTRY = {
  id: 'changelog_01h455vb4pex5vsknk084sn02q',
  title: 'Nightly build',
  status: 'draft',
  publishedAt: null,
  displayDate: null,
  createdAt: '2026-09-30T00:00:00.000Z',
  updatedAt: '2026-09-30T00:00:00.000Z',
}

function text(result: CallToolResult): string {
  return result.content.map((c) => ('text' in c ? c.text : '')).join('')
}

beforeEach(() => {
  vi.clearAllMocks()
  mockResolveCategoryRefs.mockResolvedValue([NIGHTLY_ID])
  mockCreateChangelog.mockResolvedValue(ENTRY)
  mockUpdateChangelog.mockResolvedValue(ENTRY)
})

describe('create_changelog — categories', () => {
  it('resolves category refs and forwards the ids', async () => {
    await collect(teamAuth).get('create_changelog')!({
      title: 'Nightly build',
      content: 'Fixes.',
      publish: false,
      categories: ['nightly'],
    })

    expect(mockResolveCategoryRefs).toHaveBeenCalledWith(['nightly'])
    expect(mockCreateChangelog).toHaveBeenCalledWith(
      expect.objectContaining({ categoryIds: [NIGHTLY_ID] }),
      expect.objectContaining({ principalId: 'principal_james' })
    )
  })

  it('leaves categoryIds out when categories are not given', async () => {
    await collect(teamAuth).get('create_changelog')!({
      title: 'Nightly build',
      content: 'Fixes.',
      publish: false,
    })

    expect(mockResolveCategoryRefs).not.toHaveBeenCalled()
    expect(mockCreateChangelog.mock.calls[0][0]).not.toHaveProperty('categoryIds')
  })

  it('returns an error result naming the unknown category and creates nothing', async () => {
    const { ValidationError } = await import('@/lib/shared/errors')
    mockResolveCategoryRefs.mockRejectedValue(
      new ValidationError('VALIDATION_ERROR', 'Unknown changelog categories: beta')
    )

    const result = await collect(teamAuth).get('create_changelog')!({
      title: 'Nightly build',
      content: 'Fixes.',
      publish: false,
      categories: ['beta'],
    })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('beta')
    expect(mockCreateChangelog).not.toHaveBeenCalled()
  })
})

describe('update_changelog — categories', () => {
  it('resolves category refs and forwards the ids', async () => {
    await collect(teamAuth).get('update_changelog')!({
      changelogId: ENTRY.id,
      categories: [NIGHTLY_ID],
    })

    expect(mockResolveCategoryRefs).toHaveBeenCalledWith([NIGHTLY_ID])
    expect(mockUpdateChangelog).toHaveBeenCalledWith(
      ENTRY.id,
      expect.objectContaining({ categoryIds: [NIGHTLY_ID] })
    )
  })

  it('forwards an empty list so categories can be cleared', async () => {
    mockResolveCategoryRefs.mockResolvedValue([])

    await collect(teamAuth).get('update_changelog')!({ changelogId: ENTRY.id, categories: [] })

    expect(mockUpdateChangelog).toHaveBeenCalledWith(
      ENTRY.id,
      expect.objectContaining({ categoryIds: [] })
    )
  })

  it('leaves categoryIds out when categories are not given', async () => {
    await collect(teamAuth).get('update_changelog')!({ changelogId: ENTRY.id, title: 'Renamed' })

    expect(mockResolveCategoryRefs).not.toHaveBeenCalled()
    expect(mockUpdateChangelog.mock.calls[0][1]).not.toHaveProperty('categoryIds')
  })
})
