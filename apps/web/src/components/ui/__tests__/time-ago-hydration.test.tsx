// @vitest-environment happy-dom
/**
 * The server formats the date in UTC with a fixed locale, and the browser
 * switches it to the viewer's zone and format once hydrated. That difference
 * must not surface as a hydration error.
 */
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { formatFirstRenderDate, formatViewerDate } from '../local-date'
import { TimeAgo } from '../time-ago'

const POSTED = new Date('2026-09-26T23:30:00.000Z')

describe('TimeAgo hydration', () => {
  it('serves the first-render date and hydrates to the viewer date without error', async () => {
    const container = document.createElement('div')
    container.innerHTML = renderToString(<TimeAgo date={POSTED} />)
    expect(container.textContent).toBe(formatFirstRenderDate(POSTED))

    const errors: unknown[] = []
    await act(async () => {
      hydrateRoot(container, <TimeAgo date={POSTED} />, {
        onRecoverableError: (error) => errors.push(error),
      })
    })

    expect(errors).toEqual([])
    expect(container.textContent).toBe(formatViewerDate(POSTED))
  })
})
