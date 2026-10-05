/**
 * Post User Actions
 *
 * Handles user-initiated write operations: edit, soft delete, restore, and permanent delete.
 * Permission helpers (canEditPost, canDeletePost, getPostPermissions) live in post.permissions.ts.
 */

import {
  db,
  posts,
  boards,
  postComments,
  postEditHistory,
  eq,
  and,
  sql,
  isNull,
  type Post,
} from '@/lib/server/db'
import { type PostId, type PrincipalId, type UserId } from '@quackback/ids'
import { NotFoundError, ValidationError, ForbiddenError } from '@/lib/shared/errors'
import { isTeamMember, Role } from '@/lib/shared/roles'
import { createActivity } from '@/lib/server/domains/activity/activity.service'
import {
  dispatchPostDeleted,
  dispatchPostRestored,
  dispatchPostUpdated,
  buildEventActor,
} from '@/lib/server/events/dispatch'
import { canEditPost } from './post.permissions'
import { DEFAULT_PORTAL_CONFIG, type PortalConfig } from '@/lib/server/domains/settings'
import type { UserEditPostInput } from './post.types'
import { markdownToTiptapJson } from '@/lib/server/markdown-tiptap'
import { contentHoldReason } from '@/lib/server/content/content-holds'
import { recordAuditEvent } from '@/lib/server/audit/log'
import { logger } from '@/lib/server/logger'
import { recalculateCanonicalVoteCount } from './post.merge-ids'

const log = logger.child({ component: 'post-user-actions' })

// ============================================================================
// Internal Helpers (duplicated from post.permissions.ts for independence)
// ============================================================================

async function getPortalConfig(): Promise<PortalConfig> {
  const org = await db.query.settings.findFirst()

  if (!org?.portalConfig) {
    return DEFAULT_PORTAL_CONFIG
  }

  let config: Partial<PortalConfig>
  try {
    config = JSON.parse(org.portalConfig) as Partial<PortalConfig>
  } catch {
    return DEFAULT_PORTAL_CONFIG
  }

  return {
    ...DEFAULT_PORTAL_CONFIG,
    ...config,
    features: {
      ...DEFAULT_PORTAL_CONFIG.features,
      ...(config?.features ?? {}),
    },
    moderationDefault: {
      ...DEFAULT_PORTAL_CONFIG.moderationDefault,
      ...(config?.moderationDefault ?? {}),
    },
  }
}

async function getCommentCount(postId: PostId): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(postComments)
    .where(and(eq(postComments.postId, postId), isNull(postComments.deletedAt)))

  return result[0]?.count ?? 0
}

// ============================================================================
// User Edit/Delete Operations
// ============================================================================

/**
 * User edits their own post
 * Validates permissions and records edit history if enabled
 *
 * @param postId - Post ID to edit
 * @param input - Edit data (title, content, contentJson)
 * @param actor - Actor information (principalId, role)
 * @returns Updated post
 */
export async function userEditPost(
  postId: PostId,
  input: UserEditPostInput,
  actor: { principalId: PrincipalId; role: Role }
): Promise<Post> {
  log.info({ post_id: postId, principal_id: actor.principalId, role: actor.role }, 'user edit post')
  // Validate input first (no DB needed)
  if (!input.title?.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'Title is required')
  }
  if (input.title.length > 200) {
    throw new ValidationError('VALIDATION_ERROR', 'Title must be 200 characters or less')
  }
  if (input.content.length > 10000) {
    throw new ValidationError('VALIDATION_ERROR', 'Content must be 10,000 characters or less')
  }

  // Fetch post with status + portal config in parallel (eliminates duplicate fetches)
  const [existingPost, config] = await Promise.all([
    db.query.posts.findFirst({
      where: eq(posts.id, postId),
      with: { postStatus: { columns: { isDefault: true } } },
    }),
    getPortalConfig(),
  ])

  if (!existingPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  // Check if post is deleted
  if (existingPost.deletedAt) {
    throw new ForbiddenError('EDIT_NOT_ALLOWED', 'Cannot edit a deleted post')
  }

  // Team members (admin, member) can always edit - skip further checks
  if (!isTeamMember(actor.role)) {
    // Must be the author
    if (existingPost.principalId !== actor.principalId) {
      throw new ForbiddenError('EDIT_NOT_ALLOWED', 'You can only edit your own posts')
    }

    // One rule decides both the Edit button and the save (post.permissions.ts):
    // team review of the status, other people's votes, other people's comments.
    // This used to be a second copy of those checks, which drifted (PRO-573).
    const verdict = await canEditPost(postId, actor, config)
    if (!verdict.allowed) {
      throw new ForbiddenError('EDIT_NOT_ALLOWED', verdict.reason ?? 'Cannot edit this post')
    }
  }

  // Record edit history if enabled
  if (config.features.showPublicEditHistory) {
    await db.insert(postEditHistory).values({
      postId: postId,
      editorPrincipalId: actor.principalId,
      previousTitle: existingPost.title,
      previousContent: existingPost.content,
      previousContentJson: existingPost.contentJson,
    })
  }

  const authorIsTeam = isTeamMember(actor.role)
  const nextJson = input.contentJson ?? markdownToTiptapJson(input.content.trim())
  const holdReason = authorIsTeam
    ? null
    : contentHoldReason(
        config.moderationDefault,
        nextJson,
        `${input.title.trim()}\n${input.content.trim()}`
      )
  const wasPublished = existingPost.moderationState === 'published'
  const rehold = Boolean(holdReason && wasPublished)

  // Update the post
  const [updatedPost] = await db
    .update(posts)
    .set({
      title: input.title.trim(),
      content: input.content.trim(),
      contentJson: input.contentJson,
      updatedAt: new Date(),
      ...(rehold ? { moderationState: 'pending' as const } : {}),
    })
    .where(eq(posts.id, postId))
    .returning()

  if (!updatedPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  if (rehold) {
    await recordAuditEvent({
      event: 'post.moderation.held',
      actor: { role: actor.role, type: 'user' },
      target: { type: 'post', id: postId },
      after: { moderationState: 'pending' },
      metadata: { reason: holdReason, previouslyPublished: true },
    })
  }

  // Announce the edit so integrations refresh the linked issue (the admin
  // edit path already did; the author path did not, so Linear kept the old
  // text). A post re-held for moderation announces nothing until published.
  const changedFields: string[] = []
  if (updatedPost.title !== existingPost.title) changedFields.push('title')
  if (updatedPost.content !== existingPost.content) changedFields.push('content')
  if (changedFields.length > 0 && !rehold) {
    const board = await db.query.boards.findFirst({ where: eq(boards.id, updatedPost.boardId) })
    if (board) {
      await dispatchPostUpdated(
        buildEventActor({ principalId: actor.principalId }),
        { id: postId, title: updatedPost.title, boardId: board.id, boardSlug: board.slug },
        changedFields
      )
    }
  }

  // Regenerate embedding (and cascade to merge check) after user edit
  import('@/lib/server/domains/embeddings/embedding.service')
    .then(({ generatePostEmbedding }) =>
      generatePostEmbedding(postId, updatedPost.title, updatedPost.content)
    )
    .catch((err) => log.error({ err, post_id: postId }, 'embedding regen failed'))

  return updatedPost
}

/**
 * Soft delete a post
 * Sets deletedAt timestamp, hiding from public views
 *
 * @param postId - Post ID to delete
 * @param actor - Actor information (principalId, role)
 */
export async function softDeletePost(
  postId: PostId,
  actor: { principalId: PrincipalId; role: Role; userId?: UserId },
  beforeDelete?: (tx: import('@/lib/server/db').Transaction) => Promise<void>
): Promise<void> {
  log.info(
    { post_id: postId, principal_id: actor.principalId, role: actor.role },
    'soft delete post'
  )
  // Fetch post with status + portal config in parallel (eliminates duplicate fetches)
  const [existingPost, config] = await Promise.all([
    db.query.posts.findFirst({
      where: eq(posts.id, postId),
      with: { postStatus: { columns: { isDefault: true } } },
    }),
    getPortalConfig(),
  ])

  if (!existingPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  // Check if post is already deleted
  if (existingPost.deletedAt) {
    throw new ForbiddenError('DELETE_NOT_ALLOWED', 'Post has already been deleted')
  }

  // Team members (admin, member) can always delete - skip further checks
  if (!isTeamMember(actor.role)) {
    // Must be the author
    if (existingPost.principalId !== actor.principalId) {
      throw new ForbiddenError('DELETE_NOT_ALLOWED', 'You can only delete your own posts')
    }

    // Check engagement restrictions for regular users
    if (!config.features.allowDeleteAfterEngagement) {
      // Status is default if no statusId or the status has isDefault=true
      const isDefault = !existingPost.statusId || existingPost.postStatus?.isDefault === true
      if (!isDefault) {
        throw new ForbiddenError(
          'DELETE_NOT_ALLOWED',
          'Cannot delete posts that have been reviewed by the team'
        )
      }
      if (existingPost.voteCount > 0) {
        throw new ForbiddenError(
          'DELETE_NOT_ALLOWED',
          'Cannot delete posts that have received votes'
        )
      }
      // Check for any comments
      const commentCount = await getCommentCount(postId)
      if (commentCount > 0) {
        throw new ForbiddenError('DELETE_NOT_ALLOWED', 'Cannot delete posts that have comments')
      }
    }
  }

  // Capture selected syncs in the same commit as deletion.
  const updatedPost = await db.transaction(async (tx) => {
    if (beforeDelete) await beforeDelete(tx)
    const [updated] = await tx
      .update(posts)
      .set({ deletedAt: new Date(), deletedByPrincipalId: actor.principalId })
      .where(eq(posts.id, postId))
      .returning()
    return updated
  })

  if (!updatedPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  if (existingPost.canonicalPostId) {
    await recalculateCanonicalVoteCount(existingPost.canonicalPostId as PostId)
  }

  createActivity({
    postId,
    principalId: actor.principalId,
    type: 'post.deleted',
  })

  // Dispatch post.deleted event for webhooks and integrations
  const board = await db.query.boards.findFirst({
    where: eq(boards.id, existingPost.boardId),
    columns: { slug: true },
  })
  if (board) {
    dispatchPostDeleted(buildEventActor({ principalId: actor.principalId, userId: actor.userId }), {
      id: postId,
      title: existingPost.title,
      boardId: existingPost.boardId,
      boardSlug: board.slug,
    })
  }
}

/**
 * Restore a soft-deleted post (admin only)
 *
 * Note: Authorization is handled at the action layer before calling this function.
 *
 * @param postId - Post ID to restore
 * @returns Restored post
 */
export async function restorePost(
  postId: PostId,
  actorPrincipalId?: PrincipalId,
  actorUserId?: UserId
): Promise<Post> {
  log.info({ post_id: postId }, 'restore post')
  // Get the post first to validate it exists and is deleted
  const existingPost = await db.query.posts.findFirst({ where: eq(posts.id, postId) })
  if (!existingPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  if (!existingPost.deletedAt) {
    throw new ValidationError('VALIDATION_ERROR', 'Post is not deleted')
  }

  // Enforce 30-day restore window
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  if (new Date(existingPost.deletedAt) < thirtyDaysAgo) {
    throw new ValidationError(
      'RESTORE_EXPIRED',
      'Posts can only be restored within 30 days of deletion'
    )
  }

  // Clear deletedAt and deletedByPrincipalId
  const [restoredPost] = await db
    .update(posts)
    .set({
      deletedAt: null,
      deletedByPrincipalId: null,
    })
    .where(eq(posts.id, postId))
    .returning()

  if (!restoredPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  if (restoredPost.canonicalPostId) {
    await recalculateCanonicalVoteCount(restoredPost.canonicalPostId as PostId)
  }

  createActivity({
    postId,
    principalId: actorPrincipalId ?? null,
    type: 'post.restored',
  })

  // Dispatch post.restored event for webhooks and integrations
  if (actorPrincipalId) {
    const board = await db.query.boards.findFirst({
      where: eq(boards.id, restoredPost.boardId),
      columns: { slug: true },
    })
    if (board) {
      dispatchPostRestored(
        buildEventActor({ principalId: actorPrincipalId, userId: actorUserId }),
        {
          id: postId,
          title: restoredPost.title,
          boardId: restoredPost.boardId,
          boardSlug: board.slug,
        }
      )
    }
  }

  return restoredPost
}

/**
 * Permanently delete a post (admin only)
 * This is a hard delete and cannot be undone
 *
 * Note: Authorization is handled at the action layer before calling this function.
 *
 * @param postId - Post ID to permanently delete
 */
export async function permanentDeletePost(postId: PostId): Promise<void> {
  log.info({ post_id: postId }, 'permanent delete post')
  const [deleted] = await db.delete(posts).where(eq(posts.id, postId)).returning()
  if (!deleted) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }
}
