// @vitest-environment happy-dom
/**
 * Board templates in the portal composer: the selected board's headings seed
 * the editor when the form expands, switching board replaces an untouched
 * skeleton (or clears it for a board without a template) and keeps a dirty
 * body, and submit sends the finalized body — nothing, when only untouched
 * headings remain. The editor is a stub that records the `value` it is handed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

type Doc = { json(): unknown; html(): string; markdown(): string }

const { createPost, editor } = vi.hoisted(() => ({
  createPost: vi.fn(),
  editor: {
    values: [] as unknown[],
    onDocumentChange: null as ((document: Doc) => void) | null,
  },
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn(), navigate: vi.fn() }),
  useRouteContext: (opts?: { select?: (context: never) => unknown }) => {
    const context = {
      session: { user: { name: 'Ada Example', email: 'ada@example.com', principalType: 'user' } },
    }
    return opts?.select ? opts.select(context as never) : context
  },
}))
vi.mock('@/lib/client/hooks/use-image-upload', () => ({
  usePortalMediaUpload: () => ({ upload: vi.fn() }),
}))
vi.mock('@/lib/client/mutations/portal-posts', () => ({
  useCreatePublicPost: () => ({ mutateAsync: createPost, isPending: false }),
}))
vi.mock('@/components/auth/auth-popover-context', () => ({
  useAuthPopover: () => ({ openAuthPopover: vi.fn() }),
}))
vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({ useAuthBroadcast: () => {} }))
vi.mock('@/lib/client/hooks/use-similar-posts', () => ({
  useSimilarPosts: () => ({ posts: [] }),
}))
vi.mock('@/lib/client/hooks/use-ensure-anon-session', () => ({
  useEnsureAnonSession: () => async () => true,
}))
vi.mock('@/lib/client/auth-client', () => ({ signOut: vi.fn() }))
vi.mock('@/lib/client/queries/portal', () => ({ removeViewerScopedPortalQueries: vi.fn() }))
vi.mock('@/components/public/similar-posts-card', () => ({
  SimilarPostsCard: () => null,
}))
vi.mock('@/components/public/feedback/posting-to-board', () => ({
  PostingToBoard: ({
    boards,
    onSelect,
  }: {
    boards: { id: string; name: string }[]
    onSelect: (id: string) => void
  }) => (
    <div>
      {boards.map((b) => (
        <button key={b.id} type="button" onClick={() => onSelect(b.id)}>
          {`board:${b.name}`}
        </button>
      ))}
    </div>
  ),
}))
vi.mock('framer-motion', async () => {
  const { createElement, forwardRef } = await import('react')
  const MOTION_PROPS = new Set(['initial', 'animate', 'exit', 'transition', 'variants', 'layout'])
  const make = (tag: string) =>
    forwardRef<HTMLElement, Record<string, unknown>>((props, ref) => {
      const { children, ...rest } = props
      const dom: Record<string, unknown> = { ref }
      for (const [key, value] of Object.entries(rest)) {
        if (!MOTION_PROPS.has(key)) dom[key] = value
      }
      return createElement(tag, dom, children as ReactNode)
    })
  const proxy = new Proxy(
    {},
    { get: (_target, prop) => (typeof prop === 'string' ? make(prop) : undefined) }
  )
  return {
    AnimatePresence: ({ children }: { children?: ReactNode }) => children,
    motion: proxy,
    m: proxy,
  }
})
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: (props: {
    value?: unknown
    onDocumentChange?: typeof editor.onDocumentChange
  }) => {
    editor.values.push(props.value)
    editor.onDocumentChange = props.onDocumentChange ?? null
    return <div data-testid="editor" />
  },
}))

import { FeedbackHeaderAnimated } from '../feedback-header-animated'
import { TEMPLATE_HEADING_ATTR } from '@/lib/shared/post-templates'

const BUGS = {
  id: 'board_bugs',
  name: 'Bugs',
  slug: 'bugs',
  settings: {
    template: ['What went wrong?', 'What should happen?'],
    titlePlaceholder: 'What went wrong, in one line?',
  },
}
const FEATURES = {
  id: 'board_feat',
  name: 'Features',
  slug: 'features',
  settings: { template: ['Goal?'] },
}
const GENERAL = { id: 'board_gen', name: 'General', slug: 'general', settings: {} }
const PERMS = {
  board_bugs: { canSubmit: true, canVote: true },
  board_feat: { canSubmit: true, canVote: true },
  board_gen: { canSubmit: true, canVote: true },
}

function renderHeader() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={{}} onError={() => {}}>
        <FeedbackHeaderAnimated
          workspaceName="Acme"
          boards={[BUGS, FEATURES, GENERAL]}
          defaultBoardId={BUGS.id}
          boardPermissions={PERMS}
        />
      </IntlProvider>
    </QueryClientProvider>
  )
}

function typeTitle(value: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Feedback title' }), { target: { value } })
}

function lastValue() {
  return editor.values.at(-1) as { content?: { type: string }[] } | ''
}

/** The user writes under the first heading: the body is now dirty. */
function writeUnderFirstHeading() {
  const json = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2, [TEMPLATE_HEADING_ATTR]: 'What went wrong?' },
        content: [{ type: 'text', text: 'What went wrong?' }],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'It crashed' }] },
    ],
  }
  act(() => {
    editor.onDocumentChange?.({
      json: () => json,
      html: () => '<h2>What went wrong?</h2><p>It crashed</p>',
      markdown: () => '## What went wrong?\n\nIt crashed',
    })
  })
}

beforeEach(() => {
  createPost.mockReset()
  createPost.mockResolvedValue({ id: 'post_1', board: { slug: 'bugs' } })
})

afterEach(() => {
  cleanup()
  editor.values = []
  editor.onDocumentChange = null
})

describe('portal composer board title placeholder', () => {
  it('uses the selected board hint and falls back to the generic one', async () => {
    renderHeader()
    const title = () => screen.getByRole('textbox', { name: 'Feedback title' }) as HTMLInputElement
    expect(title().placeholder).toBe('What went wrong, in one line?')
    typeTitle('D')
    await screen.findByTestId('editor')
    fireEvent.click(screen.getByRole('button', { name: 'board:General' }))
    await waitFor(() => expect(title().placeholder).toBe("What's your idea?"))
  })
})

describe('portal composer board template', () => {
  it('seeds the editor with the selected board headings when the form expands', async () => {
    renderHeader()
    typeTitle('D')
    await screen.findByTestId('editor')
    await waitFor(() => expect(lastValue()).not.toBe(''))
    expect((lastValue() as { content: { type: string }[] }).content.map((n) => n.type)).toEqual([
      'heading',
      'paragraph',
      'heading',
      'paragraph',
    ])
  })

  it('submits an empty body when nothing was written under the headings', async () => {
    renderHeader()
    typeTitle('Broken')
    await screen.findByTestId('editor')
    await waitFor(() => expect(lastValue()).not.toBe(''))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(createPost).toHaveBeenCalledTimes(1))
    expect(createPost.mock.calls[0]![0]).toMatchObject({ boardId: 'board_bugs', title: 'Broken' })
    // undefined, never null: the public create schema's contentJson is
    // `.optional()` and the server rejects null with "expected object".
    expect(createPost.mock.calls[0]![0].contentJson).toBeUndefined()
  })

  it('switching to a board without a template clears an untouched skeleton', async () => {
    renderHeader()
    typeTitle('D')
    await screen.findByTestId('editor')
    await waitFor(() => expect(lastValue()).not.toBe(''))
    fireEvent.click(screen.getByRole('button', { name: 'board:General' }))
    // '' clears the editor (its value-sync treats '' as "empty the document").
    await waitFor(() => expect(lastValue()).toBe(''))
  })

  it('switching board after writing keeps the body and offers the new template', async () => {
    renderHeader()
    typeTitle('D')
    await screen.findByTestId('editor')
    await waitFor(() => expect(lastValue()).not.toBe(''))
    const seeded = lastValue()
    writeUnderFirstHeading()
    fireEvent.click(screen.getByRole('button', { name: 'board:Features' }))
    expect(lastValue()).toBe(seeded)
    const insert = await screen.findByRole('button', { name: 'Insert Features template' })
    fireEvent.click(insert)
    await waitFor(() => {
      const content = (lastValue() as { content: { type: string }[] }).content
      expect(content.at(-2)?.type).toBe('heading')
      expect(content[1]?.type).toBe('paragraph')
    })
  })
})
