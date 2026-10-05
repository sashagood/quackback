/**
 * Real-DB coverage for the portal sidebar counters (PRO-530).
 *
 * A board's counter is its open work, not a lifetime total: posts with no
 * status or a status in the `active` category count; `complete` and `closed`
 * statuses (done, duplicate, snoozed, …) do not.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createId,
  type BoardId,
  type PostStatusId,
  type PrincipalId,
  type UserId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, posts, postStatuses, principal, user } from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'
import { ANONYMOUS_ACTOR } from '@/lib/server/policy'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { listPublicBoardsWithStats } from '../board.public'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: posts.id, statusId: posts.statusId }).from(posts).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedPrincipal(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Counter author' })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'user',
    type: 'user',
    displayName: 'Counter author',
    createdAt: new Date(),
  })
  return principalId
}

async function seedStatus(category: 'active' | 'complete' | 'closed'): Promise<PostStatusId> {
  const [row] = await testDb
    .insert(postStatuses)
    .values({ name: `${category} ${suffix()}`, slug: `${category}-${suffix()}`, category })
    .returning()
  return row.id
}

async function seedPost(boardId: BoardId, principalId: PrincipalId, statusId: PostStatusId | null) {
  await testDb.insert(posts).values({
    boardId,
    principalId,
    statusId,
    title: 'Counted?',
    content: '',
    moderationState: 'published',
  })
}

describe.skipIf(!fixture.available)('portal board counters (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('counts posts with no status or an active status, never complete or closed ones', async () => {
    const author = await seedPrincipal()
    const [board] = await testDb
      .insert(boards)
      .values({ slug: `counters-${suffix()}`, name: 'Counters', access: DEFAULT_BOARD_ACCESS })
      .returning()
    const [active, complete, closed] = await Promise.all([
      seedStatus('active'),
      seedStatus('complete'),
      seedStatus('closed'),
    ])

    await seedPost(board.id, author, null)
    await seedPost(board.id, author, null)
    await seedPost(board.id, author, active)
    await seedPost(board.id, author, complete)
    await seedPost(board.id, author, closed)

    const rows = await listPublicBoardsWithStats(ANONYMOUS_ACTOR)
    const counted = rows.find((b) => b.id === board.id)
    expect(counted?.postCount).toBe(3)
  })
})
