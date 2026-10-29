// @vitest-environment happy-dom
/**
 * A row's date is formatted on the server in UTC and again as the inbox
 * hydrates, in the viewer's zone and format. That must not surface as a
 * hydration error; the date settles on the browser's value once mounted.
 */
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import type { ConversationDTO } from '@/lib/shared/conversation/types'
import type { InboxItemDTO } from '@/lib/shared/inbox/items'
import { formatFirstRenderDate, formatViewerDate } from '@/components/ui/local-date'
import { ConversationRow } from '../conversation-list-column'

const LAST_MESSAGE_AT = '2026-10-01T03:30:37.700Z'

const conversation: Partial<ConversationDTO> = {
  id: 'conversation_01JTEST' as ConversationId,
  status: 'open',
  priority: 'none',
  channel: 'messenger',
  subject: null,
  lastMessagePreview: 'Where is my order?',
  lastMessageAt: LAST_MESSAGE_AT,
  createdAt: LAST_MESSAGE_AT,
  visitor: {
    principalId: 'principal_visitor' as PrincipalId,
    displayName: 'Rita Visitor',
    avatarUrl: null,
  },
  assignedAgent: null,
  unreadCount: 0,
  visitorLastReadAt: null,
  agentLastReadAt: null,
  csatRating: null,
  visitorEmail: null,
  resolvedAt: null,
  endReason: null,
  endNote: null,
  snoozedUntil: null,
  tags: [],
}

const item: Extract<InboxItemDTO, { kind: 'conversation' }> = {
  kind: 'conversation',
  conversation: conversation as ConversationDTO,
  linkedTicket: null,
  searchSnippet: null,
}

const row = () => (
  <ConversationRow item={item} id={item.conversation.id} selected={false} onSelect={() => {}} />
)

describe('ConversationRow hydration', () => {
  it('hydrates without error when the browser formats the date differently', async () => {
    const container = document.createElement('div')
    container.innerHTML = renderToString(row())
    expect(container.textContent).toContain(formatFirstRenderDate(LAST_MESSAGE_AT))

    const errors: unknown[] = []
    await act(async () => {
      hydrateRoot(container, row(), { onRecoverableError: (error) => errors.push(error) })
    })

    expect(errors).toEqual([])
    expect(container.textContent).toContain(formatViewerDate(LAST_MESSAGE_AT))
  })
})
