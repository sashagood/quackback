// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { BoardId } from '@quackback/ids'

const mutate = vi.fn()
vi.mock('@/lib/client/mutations', () => ({
  useUpdateBoard: () => ({
    mutate,
    isPending: false,
    isError: false,
    error: null,
  }),
}))

const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}))

import { BoardGeneralForm } from '../board-general-form'

const board = {
  id: 'board_01test' as BoardId,
  name: 'Bug Reports',
  slug: 'bugs',
  description: 'Track issues',
}

beforeEach(() => {
  mutate.mockReset()
  navigate.mockReset()
})

async function edit(label: string, value: string) {
  const field = screen.getByLabelText(label)
  fireEvent.change(field, { target: { value } })
  await act(async () => {
    fireEvent.blur(field)
  })
}

describe('<BoardGeneralForm> autosave', () => {
  it('has no Save button', () => {
    render(<BoardGeneralForm board={board} />)
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull()
  })

  it('saves when a field loses focus after an edit', async () => {
    render(<BoardGeneralForm board={board} />)
    await edit('Description', 'Updated description')
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate.mock.calls[0]![0]).toEqual({
      id: board.id,
      name: 'Bug Reports',
      description: 'Updated description',
    })
  })

  it('does not save when nothing changed', async () => {
    render(<BoardGeneralForm board={board} />)
    await act(async () => {
      fireEvent.blur(screen.getByLabelText('Name'))
    })
    expect(mutate).not.toHaveBeenCalled()
  })

  it('does not save an empty name', async () => {
    render(<BoardGeneralForm board={board} />)
    await edit('Name', '')
    expect(mutate).not.toHaveBeenCalled()
  })
})

describe('<BoardGeneralForm> rename navigation', () => {
  it('navigates to the new slug when a rename changes it', async () => {
    render(<BoardGeneralForm board={board} />)
    await edit('Name', 'Issue Tracker')

    expect(mutate).toHaveBeenCalledTimes(1)
    const opts = mutate.mock.calls[0]![1] as { onSuccess: (b: { slug: string }) => void }
    act(() => {
      opts.onSuccess({ slug: 'issue-tracker' })
    })

    expect(navigate).toHaveBeenCalledWith({
      to: '/admin/settings/boards/$slug',
      params: { slug: 'issue-tracker' },
      search: {},
      replace: true,
    })
  })

  it('does not navigate when the slug is unchanged', async () => {
    render(<BoardGeneralForm board={board} />)
    await edit('Description', 'Updated description')

    const opts = mutate.mock.calls[0]![1] as { onSuccess: (b: { slug: string }) => void }
    act(() => {
      opts.onSuccess({ slug: 'bugs' })
    })

    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('<BoardGeneralForm> post template', () => {
  it('shows the board headings one per line and saves them merged into settings', async () => {
    render(
      <BoardGeneralForm
        board={{ ...board, settings: { template: ['What went wrong?', 'What should happen?'] } }}
      />
    )
    const field = screen.getByLabelText('Post template') as HTMLTextAreaElement
    expect(field.value).toBe('What went wrong?\nWhat should happen?')
    await edit('Post template', 'What went wrong?\n\n  Steps to reproduce  \n')
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate.mock.calls[0]![0]).toMatchObject({
      id: board.id,
      settings: { template: ['What went wrong?', 'Steps to reproduce'] },
    })
  })

  it('saves a trimmed title placeholder and clears it when emptied', async () => {
    render(<BoardGeneralForm board={{ ...board, settings: { titlePlaceholder: 'Old hint' } }} />)
    const field = screen.getByLabelText('Title placeholder') as HTMLInputElement
    expect(field.value).toBe('Old hint')
    await edit('Title placeholder', '  What went wrong, in one line?  ')
    expect(mutate.mock.calls[0]![0]).toMatchObject({
      settings: { titlePlaceholder: 'What went wrong, in one line?' },
    })

    mutate.mockReset()
    await edit('Title placeholder', '')
    // Sent as '' (not omitted): JSON drops undefined, and the server clears on ''.
    const sent = mutate.mock.calls[0]![0] as { settings: Record<string, unknown> }
    expect(sent.settings.titlePlaceholder).toBe('')
  })

  it('renders a malformed stored template as empty instead of crashing', () => {
    render(
      <BoardGeneralForm
        board={{ ...board, settings: { template: 'oops' as unknown as string[] } }}
      />
    )
    expect((screen.getByLabelText('Post template') as HTMLTextAreaElement).value).toBe('')
  })

  it('saves an empty template as no template', async () => {
    render(<BoardGeneralForm board={{ ...board, settings: { template: ['A'] } }} />)
    await edit('Post template', '')
    expect(mutate.mock.calls[0]![0]).toMatchObject({ settings: { template: [] } })
  })

  it('refuses more than 8 headings without calling the server', async () => {
    render(<BoardGeneralForm board={board} />)
    await edit('Post template', Array.from({ length: 9 }, (_, i) => `H${i}`).join('\n'))
    expect(mutate).not.toHaveBeenCalled()
    expect(screen.getByText(/at most 8 headings/)).toBeTruthy()
  })
})
