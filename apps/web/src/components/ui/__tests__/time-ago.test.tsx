// @vitest-environment happy-dom
/**
 * Relative wording ("3 days ago") only helps while the reader can still place
 * it; past a week it costs them a subtraction and dates nothing precisely
 * (PRO-1664 follow-up from the portal). From seven days on the label is the
 * absolute date, and the full timestamp always sits in the tooltip.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TimeAgo, getTimeAgo } from '../time-ago'

const NOW = new Date('2026-10-27T12:00:00.000Z')

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function at(now: Date) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
}

describe('getTimeAgo', () => {
  it('stays relative inside the first week', () => {
    at(NOW)
    expect(getTimeAgo(new Date('2026-10-27T11:30:00.000Z'))).toBe('30 minutes ago')
    expect(getTimeAgo(new Date('2026-10-24T12:00:00.000Z'))).toBe('3 days ago')
    expect(getTimeAgo(new Date('2026-10-20T12:00:01.000Z'))).toBe('7 days ago')
  })

  it('switches to the absolute date from seven days on', () => {
    at(NOW)
    expect(getTimeAgo(new Date('2026-10-20T12:00:00.000Z'))).toBe('20 October 2026')
    expect(getTimeAgo(new Date('2026-10-10T08:00:00.000Z'))).toBe('10 October 2026')
    expect(getTimeAgo(new Date('2025-03-01T08:00:00.000Z'))).toBe('1 March 2025')
  })

  it('accepts ISO strings and rejects invalid input', () => {
    at(NOW)
    expect(getTimeAgo('2026-10-01T08:00:00.000Z')).toBe('1 October 2026')
    expect(getTimeAgo('not a date')).toBe('')
    expect(getTimeAgo(null)).toBe('')
  })
})

describe('TimeAgo', () => {
  it('renders the label with the full timestamp as the tooltip', () => {
    at(NOW)
    const { container } = render(<TimeAgo date={new Date('2026-10-10T08:05:00.000Z')} />)
    const span = container.querySelector('span')
    expect(span?.textContent).toBe('10 October 2026')
    expect(span?.getAttribute('title')).toMatch(/^10 October 2026, \d{2}:\d{2}$/)
  })

  it('keeps the tooltip on relative labels too', () => {
    at(NOW)
    const { container } = render(<TimeAgo date={new Date('2026-10-26T12:00:00.000Z')} />)
    const span = container.querySelector('span')
    expect(span?.textContent).toBe('1 day ago')
    expect(span?.getAttribute('title')).toMatch(/^26 October 2026, \d{2}:\d{2}$/)
  })
})
