import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadResourceCallback } from '@modelcontextprotocol/sdk/server/mcp.js'

const mockListCategories = vi.fn()
vi.mock('@/lib/server/domains/changelog/changelog-category.service', () => ({
  listChangelogCategories: (...args: unknown[]) => mockListCategories(...args),
}))

import { registerResources } from '../server'
import type { McpAuthContext } from '../types'

const URI = 'quackback://changelog/categories'

function collect(auth: McpAuthContext): Map<string, ReadResourceCallback> {
  const callbacks = new Map<string, ReadResourceCallback>()
  const fakeServer = {
    resource: (_name: string, uri: string, _meta: unknown, cb: ReadResourceCallback) => {
      callbacks.set(uri, cb)
    },
  }
  registerResources(fakeServer as never, auth)
  return callbacks
}

async function read(auth: McpAuthContext) {
  const cb = collect(auth).get(URI)!
  const result = await cb(new URL(URI), {} as never)
  return result.contents[0] as { uri: string; mimeType: string; text: string }
}

const teamAuth = {
  principalId: 'principal_james',
  userId: 'user_1',
  name: 'James',
  email: 'james@quackback.io',
  role: 'admin' as const,
  authMethod: 'oauth' as const,
  scopes: ['read:feedback'],
} as unknown as McpAuthContext

const NIGHTLY = {
  id: 'changelog_category_01h455vb4pex5vsknk084sn02q',
  name: 'Nightly',
  color: '#6b7280',
  segmentIds: ['segment_01h455vb4pex5vsknk084sn02q'],
  position: 0,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
}

beforeEach(() => {
  vi.clearAllMocks()
  mockListCategories.mockResolvedValue([NIGHTLY])
})

describe('quackback://changelog/categories resource', () => {
  it('lists labels with id, name, color, and position only', async () => {
    const content = await read(teamAuth)

    expect(content.uri).toBe(URI)
    expect(content.mimeType).toBe('application/json')
    expect(JSON.parse(content.text)).toEqual([
      { id: NIGHTLY.id, name: 'Nightly', color: '#6b7280', position: 0 },
    ])
  })

  it('is team-only, matching the REST endpoint permission', async () => {
    const portal = { ...(teamAuth as object), role: 'user' } as McpAuthContext

    const content = await read(portal)

    expect(content.mimeType).toBe('text/plain')
    expect(content.text).toContain('team member')
    expect(mockListCategories).not.toHaveBeenCalled()
  })

  it('is denied without the read:feedback scope', async () => {
    const readless = { ...(teamAuth as object), scopes: ['write:changelog'] } as McpAuthContext

    const content = await read(readless)

    expect(content.text).toContain('Insufficient scope')
    expect(mockListCategories).not.toHaveBeenCalled()
  })
})
