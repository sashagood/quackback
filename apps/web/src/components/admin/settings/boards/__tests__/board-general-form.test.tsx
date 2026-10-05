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

describe('<BoardGeneralForm> rename navigation', () => {
  it('navigates to the new slug when a rename changes it', async () => {
    render(<BoardGeneralForm board={board} />)
    fireEvent.change(screen.getByLabelText('Board name'), {
      target: { value: 'Issue Tracker' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    })

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
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Updated description' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    })

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
    fireEvent.change(field, { target: { value: 'What went wrong?\n\n  Steps to reproduce  \n' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    })
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate.mock.calls[0]![0]).toMatchObject({
      id: board.id,
      settings: { template: ['What went wrong?', 'Steps to reproduce'] },
    })
  })

  it('saves an empty template as no template', async () => {
    render(<BoardGeneralForm board={{ ...board, settings: { template: ['A'] } }} />)
    fireEvent.change(screen.getByLabelText('Post template'), { target: { value: '' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    })
    expect(mutate.mock.calls[0]![0]).toMatchObject({ settings: { template: [] } })
  })

  it('refuses more than 8 headings without calling the server', async () => {
    render(<BoardGeneralForm board={board} />)
    fireEvent.change(screen.getByLabelText('Post template'), {
      target: { value: Array.from({ length: 9 }, (_, i) => `H${i}`).join('\n') },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    })
    expect(mutate).not.toHaveBeenCalled()
    expect(screen.getByText(/at most 8 headings/)).toBeTruthy()
  })
})
