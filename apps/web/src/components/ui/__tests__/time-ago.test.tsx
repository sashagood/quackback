// @vitest-environment happy-dom
/**
 * Relative wording ("17 days ago") makes the reader work the date out and
 * dates nothing precisely (PRO-1664 follow-up from the portal). Every label is
 * the date, formatted by the shared local-date primitive, with the full
 * timestamp as its tooltip.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NUMERIC_DATE_TIME, formatViewerDate } from '../local-date'
import { TimeAgo } from '../time-ago'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('TimeAgo', () => {
  it('renders the date, never a relative age, however recent', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-27T12:00:00.000Z'))
    const recent = new Date('2026-10-27T11:55:00.000Z')
    const { container } = render(<TimeAgo date={recent} />)
    expect(container.textContent).toBe(formatViewerDate(recent))
    expect(container.textContent).not.toMatch(/ago|now/)
  })

  it('carries the full timestamp as the tooltip', () => {
    const d = new Date('2026-10-10T08:05:00.000Z')
    const { container } = render(<TimeAgo date={d.toISOString()} />)
    const time = container.querySelector('span')
    expect(time?.textContent).toBe(formatViewerDate(d))
    expect(time?.getAttribute('title')).toBe(formatViewerDate(d, NUMERIC_DATE_TIME))
  })

  it('renders nothing for an invalid date', () => {
    const { container } = render(<TimeAgo date="not a date" />)
    expect(container.innerHTML).toBe('')
  })
})
