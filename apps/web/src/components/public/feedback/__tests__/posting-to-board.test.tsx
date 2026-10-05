// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { PostingToBoard } from '../posting-to-board'

vi.mock('@/components/ui/select', async () => import('@/test/radix-select'))

const boards = [
  { id: 'board_1', name: 'Feature Requests', slug: 'features' },
  { id: 'board_2', name: 'Bug Reports', slug: 'bugs' },
]

function renderRow() {
  const onSelect = vi.fn()
  const result = render(
    <IntlProvider locale="en" defaultLocale="en">
      <PostingToBoard boards={boards} selectedBoardId="board_1" onSelect={onSelect} />
    </IntlProvider>
  )
  return { onSelect, ...result }
}

describe('PostingToBoard', () => {
  it('renders a board switcher with the page board preselected', () => {
    renderRow()
    expect(screen.getByLabelText('Posting to Feature Requests')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveValue('board_1')
  })

  // PRO-540: there is no locked mode. On a board page the composer used to
  // render the board as a static label, which readers took for a dropdown
  // that "sometimes" does not open.
  it('has no locked mode: every board stays selectable', () => {
    renderRow()
    expect(screen.getByRole('option', { name: 'Bug Reports' })).toBeInTheDocument()
    expect(PostingToBoard.length).toBe(1)
    expect(screen.queryByText('Feature Requests', { selector: 'span' })).not.toBeInTheDocument()
  })
})
