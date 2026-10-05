// @vitest-environment happy-dom
/**
 * Board templates in the widget composer: the selected board's headings seed
 * the editor when the composer expands, and submit sends the finalized body
 * (null when only untouched headings remain). The editor is a stub that
 * records the `value` it is handed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { WidgetHomeProps } from '../widget-home-animated'

const { createPost, editor } = vi.hoisted(() => ({
  createPost: vi.fn(),
  editor: { values: [] as unknown[] },
}))

vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({
    ensureSession: async () => true,
    ensureSessionThen: async (cb: () => void | Promise<void>) => cb(),
    isIdentified: true,
    hmacRequired: true,
    user: { name: 'Ada', email: 'ada@example.com' },
    emitEvent: vi.fn(),
    metadata: null,
    getSessionVersion: () => 0,
    sessionVersion: 0,
  }),
}))
vi.mock('@/lib/client/widget-auth', () => ({
  getWidgetAuthHeaders: () => ({ Authorization: 'Bearer test' }),
}))
vi.mock('@/lib/client/widget-bridge', () => ({ sendToHost: vi.fn() }))
vi.mock('../use-widget-image-upload', () => ({
  useWidgetMediaUpload: () => ({ upload: vi.fn() }),
  WidgetSessionError: class WidgetSessionError extends Error {},
}))
vi.mock('../widget-vote-button', () => ({ WidgetVoteButton: () => null }))
vi.mock('framer-motion', async () => {
  const { createElement, forwardRef } = await import('react')
  const MOTION_PROPS = new Set([
    'initial',
    'animate',
    'exit',
    'transition',
    'variants',
    'layout',
    'whileHover',
    'whileTap',
    'whileFocus',
    'whileInView',
  ])
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
    useReducedMotion: () => true,
  }
})
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: (props: { value?: unknown }) => {
    editor.values.push(props.value)
    return <div data-testid="editor" />
  },
}))
vi.mock('@/components/ui/select', async () => import('@/test/radix-select'))
vi.mock('@/lib/server/functions/widget/posts', () => ({
  widgetListPublicPostsFn: vi.fn(async () => ({ items: [], hasMore: false, total: 0 })),
  widgetCreatePublicPostFn: (...args: unknown[]) => createPost(...args),
}))

import { WidgetHomeAnimated } from '../widget-home-animated'

const bugs = {
  id: 'board_bugs',
  name: 'Bugs',
  slug: 'bugs',
  template: ['What went wrong?', 'What should happen?'],
  titlePlaceholder: 'What went wrong, in one line?',
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <IntlProvider locale="en">{children}</IntlProvider>
    </QueryClientProvider>
  )
}

function renderHome(props: Partial<WidgetHomeProps> = {}) {
  return render(
    <WidgetHomeAnimated
      initialPosts={[]}
      statuses={[]}
      boards={props.boards ?? [bugs]}
      boardPermissions={{ board_bugs: { canSubmit: true, canVote: true } }}
      defaultBoard={props.defaultBoard}
    />,
    { wrapper }
  )
}

function typeTitle(value: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Feedback title' }), { target: { value } })
}

function lastValue() {
  return editor.values.at(-1) as { content?: { type: string }[] } | ''
}

beforeEach(() => {
  createPost.mockReset()
  createPost.mockResolvedValue({
    id: 'post_1',
    title: 'Crash',
    voteCount: 1,
    statusId: null,
    board: { id: 'board_bugs', name: 'Bugs', slug: 'bugs' },
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ data: { posts: [] } }) }))
  )
})

afterEach(() => {
  cleanup()
  editor.values = []
  vi.unstubAllGlobals()
})

describe('widget composer board title placeholder', () => {
  it('uses the selected board hint, or the generic one when the board has none', () => {
    renderHome()
    const title = screen.getByRole('textbox', { name: 'Feedback title' }) as HTMLInputElement
    expect(title.placeholder).toBe('What went wrong, in one line?')
    cleanup()
    renderHome({ boards: [{ id: 'board_gen', name: 'General', slug: 'general' }] })
    const generic = screen.getByRole('textbox', { name: 'Feedback title' }) as HTMLInputElement
    expect(generic.placeholder).toBe("What's your idea?")
  })
})

describe('widget composer board template', () => {
  it('seeds the body with the selected board template when the composer expands', async () => {
    renderHome()
    typeTitle('Crash')
    await screen.findByTestId('editor')
    await waitFor(() => expect(lastValue()).not.toBe(''))
    expect((lastValue() as { content: { type: string }[] }).content.map((n) => n.type)).toEqual([
      'heading',
      'paragraph',
      'heading',
      'paragraph',
    ])
  })

  it('a host prefill after a template seed shows the host body, not the stale skeleton', async () => {
    const { rerender } = renderHome()
    typeTitle('Crash')
    await screen.findByTestId('editor')
    await waitFor(() => expect(lastValue()).not.toBe(''))
    rerender(
      <WidgetHomeAnimated
        initialPosts={[]}
        statuses={[]}
        boards={[bugs]}
        boardPermissions={{ board_bugs: { canSubmit: true, canVote: true } }}
        composeRequest={{ nonce: 1, title: 'From host', body: 'host text', boardSlug: 'bugs' }}
      />
    )
    await waitFor(() => {
      const value = lastValue() as { content?: { type: string; content?: { text?: string }[] }[] }
      expect(value).not.toBe('')
      expect(value.content?.[0]?.type).toBe('paragraph')
      expect(value.content?.[0]?.content?.[0]?.text).toBe('host text')
    })
  })

  it('submits a null body when nothing was written under the headings', async () => {
    renderHome()
    typeTitle('Crash')
    await screen.findByTestId('editor')
    await waitFor(() => expect(lastValue()).not.toBe(''))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(createPost).toHaveBeenCalled())
    const sent = createPost.mock.calls[0]![0] as {
      data: { contentJson?: unknown; content: string }
    }
    expect(sent.data.contentJson).toBeUndefined()
    expect(sent.data.content).toBe('')
  })
})
