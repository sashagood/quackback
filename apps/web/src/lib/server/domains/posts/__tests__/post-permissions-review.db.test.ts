/**
 * Real-DB coverage for the author edit window (PRO-573).
 *
 * "Reviewed by the team" means a team member changed the status from inside
 * Quackback. Both real writers run here: the integration mirror
 * (applySyncedPostStatus, service principal) must leave the author's edit
 * window open; the human status service (changeStatus) must close it. The
 * mocked unit tests never execute the SQL; this suite does.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createId,
  type BoardId,
  type PostId,
  type PostStatusId,
  type PrincipalId,
  type UserId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, posts, postStatuses, principal, user, postActivity, eq } from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const { dispatchPostUpdated } = vi.hoisted(() => ({
  dispatchPostUpdated: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchPostStatusChanged: vi.fn().mockResolvedValue(undefined),
  dispatchPostUpdated,
  buildEventActor: vi.fn((actor) => actor),
}))

import { getPostPermissions, canEditPost } from '../post.permissions'
import { userEditPost } from '../post.user-actions'
import { changeStatus } from '../post.status'
import { applySyncedPostStatus } from '../post-status-sync'
import { createServicePrincipal } from '@/lib/server/domains/principals/principal.factory'
import { DEFAULT_PORTAL_CONFIG } from '@/lib/server/domains/settings'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: postActivity.id }).from(postActivity).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedPerson(role: 'user' | 'admin'): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `${role} ${suffix()}` })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role,
    type: 'user',
    displayName: role,
    createdAt: new Date(),
  })
  return principalId
}

async function seedBoard(): Promise<BoardId> {
  const [board] = await testDb
    .insert(boards)
    .values({ slug: `review-${suffix()}`, name: 'Review board', access: DEFAULT_BOARD_ACCESS })
    .returning()
  return board.id
}

async function seedStatus(isDefault: boolean): Promise<PostStatusId> {
  const [row] = await testDb
    .insert(postStatuses)
    .values({
      name: `${isDefault ? 'open' : 'triage'} ${suffix()}`,
      slug: `${isDefault ? 'open' : 'triage'}-${suffix()}`,
      category: 'active',
      isDefault,
    })
    .returning()
  return row.id
}

async function seedPost(boardId: BoardId, author: PrincipalId, statusId: PostStatusId) {
  const [post] = await testDb
    .insert(posts)
    .values({
      boardId,
      principalId: author,
      statusId,
      title: 'Mine',
      content: '',
      moderationState: 'published',
      voteCount: 0,
    })
    .returning()
  return post.id as PostId
}

/** createActivity is fire-and-forget; wait for the row before asserting. */
async function waitForActivity(postId: PostId, type: string) {
  await vi.waitFor(async () => {
    const rows = await testDb
      .select({ id: postActivity.id })
      .from(postActivity)
      .where(eq(postActivity.postId, postId))
    expect(rows.length).toBeGreaterThan(0)
    const typed = await testDb
      .select({ type: postActivity.type })
      .from(postActivity)
      .where(eq(postActivity.postId, postId))
    expect(typed.some((r) => r.type === type)).toBe(true)
  })
}

describe.skipIf(!fixture.available)('author edit window vs. status writers (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('stays open after the integration mirror moves the post off the default status', async () => {
    const author = await seedPerson('user')
    const actor = { principalId: author, role: 'user' as const }
    const boardId = await seedBoard()
    const [open, triage] = await Promise.all([seedStatus(true), seedStatus(false)])
    const postId = await seedPost(boardId, author, open)
    const integration = await createServicePrincipal(
      { role: 'member', displayName: 'Linear', serviceMetadata: { kind: 'integration' } as never },
      testDb
    )

    await testDb.transaction((tx) =>
      applySyncedPostStatus(tx, postId, triage, integration.id, { externalStatus: 'Triage' })
    )

    const [row] = await testDb
      .select({ statusId: posts.statusId })
      .from(posts)
      .where(eq(posts.id, postId))
    expect(row.statusId).toBe(triage)
    const after = await getPostPermissions(postId, actor)
    expect(after.canEdit).toEqual({ allowed: true })
    await expect(canEditPost(postId, actor, DEFAULT_PORTAL_CONFIG)).resolves.toEqual({
      allowed: true,
    })

    // The save goes through, and the edit is announced for the Linear refresh.
    const saved = await userEditPost(
      postId,
      { title: 'Mine, clarified', content: 'now with steps' },
      actor
    )
    expect(saved.title).toBe('Mine, clarified')
    expect(dispatchPostUpdated).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: postId, title: 'Mine, clarified' }),
      ['title', 'content']
    )
  })

  it('closes once a team member changes the status from inside Quackback', async () => {
    const author = await seedPerson('user')
    const admin = await seedPerson('admin')
    const actor = { principalId: author, role: 'user' as const }
    const boardId = await seedBoard()
    const [open, triage] = await Promise.all([seedStatus(true), seedStatus(false)])
    const postId = await seedPost(boardId, author, open)

    await changeStatus(postId, triage, { principalId: admin })
    await waitForActivity(postId, 'status.changed')

    const after = await getPostPermissions(postId, actor)
    expect(after.canEdit).toEqual({
      allowed: false,
      reason: 'Cannot edit posts that have been reviewed by the team',
    })
    await expect(canEditPost(postId, actor, DEFAULT_PORTAL_CONFIG)).resolves.toMatchObject({
      allowed: false,
    })
    await expect(userEditPost(postId, { title: 'Sneaky', content: '' }, actor)).rejects.toThrow(
      'Cannot edit posts that have been reviewed by the team'
    )
  })
})
