// @vitest-environment happy-dom
/**
 * Board templates in the admin create-post dialog: the selected board's
 * headings seed the editor when the dialog opens, and submitting with
 * nothing written under them sends no body. The editor is a stub that
 * records the `value` it is handed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Board, PostStatusEntity } from '@/lib/shared/db-types'
import type { CurrentUser } from '@/lib/shared/types/inbox'

const { mutate, editor } = vi.hoisted(() => ({
  mutate: vi.fn(),
  editor: { values: [] as unknown[] },
}))

vi.mock('@/lib/client/mutations/posts', () => ({
  useCreatePost: () => ({ mutate, isPending: false, isError: false, error: null, reset: vi.fn() }),
}))
vi.mock('@/lib/client/mutations', () => ({
  useCreatePortalUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdatePortalUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/lib/client/hooks/use-similar-posts', () => ({
  useSimilarPosts: () => ({ posts: [] }),
}))
vi.mock('@/lib/client/hooks/use-image-upload', () => ({
  usePostMediaUpload: () => ({ upload: vi.fn() }),
}))
vi.mock('@/components/public/similar-posts-card', () => ({ SimilarPostsCard: () => null }))
vi.mock('@/components/shared/author-selector', () => ({ AuthorSelector: () => null }))
vi.mock('@/components/ui/select', async () => import('@/test/radix-select'))
vi.mock('@/components/ui/lazy-rich-text-editor', async () => ({
  // The facade re-exports the real draft hook; only the editor is stubbed.
  usePostTemplateDraft: (await import('@/components/shared/use-post-template-draft'))
    .usePostTemplateDraft,
  LazyRichTextEditor: (props: { value?: unknown }) => {
    editor.values.push(props.value)
    return <div data-testid="editor" />
  },
}))

import { CreatePostDialog } from '../create-post-dialog'

const BUGS = {
  id: 'board_01h455vb4pex5vsknk084sn02q',
  name: 'Bugs',
  slug: 'bugs',
  description: null,
  settings: { template: ['What went wrong?', 'What should happen?'] },
} as unknown as Board
const OPEN_STATUS = {
  id: 'post_status_01h455vb4pex5vsknk084sn02q',
  name: 'Open',
  isDefault: true,
} as unknown as PostStatusEntity
const USER = { principalId: 'principal_me', name: 'Ada', email: 'ada@example.com' } as CurrentUser

function lastValue() {
  return editor.values.at(-1) as { content?: { type: string }[] } | '' | null
}

beforeEach(() => {
  mutate.mockReset()
})
afterEach(() => {
  cleanup()
  editor.values = []
})

describe('admin create-post dialog board template', () => {
  it('seeds the editor with the default board headings when it opens', async () => {
    render(
      <CreatePostDialog
        boards={[BUGS]}
        tags={[]}
        statuses={[OPEN_STATUS]}
        currentUser={USER}
        open
      />
    )
    await screen.findByTestId('editor')
    await waitFor(() => expect(lastValue()).toBeTruthy())
    expect((lastValue() as { content: { type: string }[] }).content.map((n) => n.type)).toEqual([
      'heading',
      'paragraph',
      'heading',
      'paragraph',
    ])
  })

  it('submits no body when nothing was written under the headings', async () => {
    render(
      <CreatePostDialog
        boards={[BUGS]}
        tags={[]}
        statuses={[OPEN_STATUS]}
        currentUser={USER}
        open
      />
    )
    await screen.findByTestId('editor')
    await waitFor(() => expect(lastValue()).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText("What's the feedback about?"), {
      target: { value: 'Broken' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create post' }))
    })
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
    expect(mutate.mock.calls[0]![0]).toMatchObject({
      title: 'Broken',
      boardId: 'board_01h455vb4pex5vsknk084sn02q',
    })
    // undefined, never null: the server schema's contentJson is `.optional()`.
    expect(mutate.mock.calls[0]![0].contentJson).toBeUndefined()
  })
})
