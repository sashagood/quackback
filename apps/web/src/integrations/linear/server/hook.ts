import { deliveryError } from '@/lib/server/integrations/sync/outcomes'
/**
 * Linear hook handler.
 * Creates Linear issues for new feedback, refreshes them after edits, and
 * forwards public comments to the linked issue.
 */

import type { IntegrationHook, DeliveryOutcome } from '@/lib/server/integrations/sync/outcomes'
import type {
  CommentCreatedEvent,
  EventData,
  EventPostData,
  PostUpdatedEvent,
} from '@/lib/server/events/types'
import {
  buildLinearCommentBody,
  buildLinearIssueBody,
  buildLinearIssueBodyFromPost,
} from '@/integrations/linear/server/message'
import { linearIssues, updateLinearIssue } from '@/integrations/linear/server/issues'
import {
  createLinearComment,
  findLinkedLinearIssueId,
  hasPendingLinearIssueCreate,
} from '@/integrations/linear/server/comments'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'linear' })

/** How long to wait before re-checking for an issue whose creation is still in flight. */
const LINK_RETRY_DELAY_MS = 30_000

/** Post fields whose edits change what the Linear issue shows. */
const ISSUE_CONTENT_FIELDS = ['title', 'content']

export interface LinearTarget {
  channelId: string // teamId is stored as channelId for consistency
}

export interface LinearConfig {
  accessToken: string
  rootUrl: string
  /** Set by the sync worker; identifies which installation's links to comment on. */
  integrationId?: string
}

/**
 * The Linear issue this installation linked to a post, or the delivery outcome
 * to return when there is none. The issue for a brand-new post may still be
 * queued; waiting lets the follow-up land once it exists instead of being
 * dropped by a race with the create.
 */
async function resolveLinkedIssue(
  postId: string,
  integrationId: string
): Promise<string | DeliveryOutcome> {
  const issueId = await findLinkedLinearIssueId(postId, integrationId)
  if (issueId) return issueId
  if (await hasPendingLinearIssueCreate(postId, integrationId)) {
    log.debug({ post_id: postId }, 'linked issue not created yet, waiting')
    return { state: 'retry_wait', errorCode: 'unavailable', retryAfterMs: LINK_RETRY_DELAY_MS }
  }
  log.debug({ post_id: postId }, 'no linked issue for post, skipping')
  return { state: 'succeeded' }
}

/**
 * Keep the linked issue's title and description current after a post edit.
 * The sync worker re-reads the post before dispatch, so the event carries the
 * full current post, not the reference it was published with.
 */
async function syncPostUpdate(
  event: PostUpdatedEvent,
  config: LinearConfig
): Promise<DeliveryOutcome> {
  if (!config.integrationId) return { state: 'succeeded' }
  if (!event.data.changedFields.some((field) => ISSUE_CONTENT_FIELDS.includes(field)))
    return { state: 'succeeded' }
  const post = event.data.post as Partial<EventPostData> & PostUpdatedEvent['data']['post']
  if (typeof post.content !== 'string') {
    log.error({ post_id: post.id }, 'post edit reached the hook without refreshed content')
    return { state: 'failed', errorCode: 'provider_failed' }
  }

  const linked = await resolveLinkedIssue(post.id, config.integrationId)
  if (typeof linked !== 'string') return linked

  try {
    const body = buildLinearIssueBodyFromPost(post as EventPostData, config.rootUrl)
    const updated = await updateLinearIssue(config.accessToken, linked, body)
    log.info({ issue_id: linked, post_id: post.id }, 'issue refreshed after post edit')
    return {
      state: 'succeeded',
      result: {
        externalId: updated.externalId,
        externalDisplayId: updated.externalDisplayId,
        externalUrl: updated.externalUrl ?? undefined,
      },
    }
  } catch (error) {
    return deliveryError(error)
  }
}

/**
 * Mirror a public comment onto the Linear issue linked to its post. The sync
 * ledger already filtered private, unpublished, and deleted comments and owns
 * idempotency, so this only has to find the issue and post the comment.
 */
async function syncComment(
  event: CommentCreatedEvent,
  config: LinearConfig
): Promise<DeliveryOutcome> {
  if (event.data.comment.isPrivate || !config.integrationId) return { state: 'succeeded' }

  const linked = await resolveLinkedIssue(event.data.post.id, config.integrationId)
  if (typeof linked !== 'string') return linked

  try {
    const commentId = await createLinearComment(
      config.accessToken,
      linked,
      buildLinearCommentBody(event, config.rootUrl)
    )
    log.info({ issue_id: linked, comment_id: commentId }, 'comment created')
    return { state: 'succeeded', result: { externalId: commentId } }
  } catch (error) {
    return deliveryError(error)
  }
}

export const linearHook: IntegrationHook = {
  async run(event: EventData, target: unknown, config: unknown): Promise<DeliveryOutcome> {
    const { channelId: teamId } = target as LinearTarget
    const linearConfig = config as LinearConfig
    const { accessToken, rootUrl } = linearConfig

    if (event.type === 'comment.created') {
      return syncComment(event, linearConfig)
    }
    if (event.type === 'post.updated') {
      return syncPostUpdate(event, linearConfig)
    }

    // Only create issues for new feedback. Edits refresh the existing issue above.
    if (event.type !== 'post.created') {
      return { state: 'succeeded' }
    }

    log.debug({ event_type: event.type, team_id: teamId }, 'creating issue')

    const { title, description } = buildLinearIssueBody(event, rootUrl)

    try {
      // The capability owns the GraphQL call + error classification; this
      // hook returns the same explicit delivery outcome as every provider.
      const created = await linearIssues.create!({
        auth: { channelId: teamId, accessToken },
        title,
        bodyMarkdown: description,
      })

      log.info(
        {
          issue_id: created.externalId,
          issue_identifier: created.externalDisplayId,
          team_id: teamId,
        },
        'issue created'
      )
      return {
        state: 'succeeded',
        result: {
          externalId: created.externalId,
          externalDisplayId: created.externalDisplayId ?? undefined,
          externalUrl: created.externalUrl ?? undefined,
        },
      }
    } catch (error) {
      return deliveryError(error)
    }
  },
}
