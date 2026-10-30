// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { formatViewerDate } from '@/components/ui/local-date'
import { WidgetLastDetected } from '../widget-last-detected'

describe('WidgetLastDetected', () => {
  it('renders nothing without a date', () => {
    const { container } = render(<WidgetLastDetected at={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the last-detected date', () => {
    const at = new Date(Date.now() - 5 * 60_000).toISOString()
    render(<WidgetLastDetected at={at} />)
    expect(screen.getByText(/Last detected/)).toBeInTheDocument()
    expect(screen.getByText(formatViewerDate(at, {}, 'en'))).toBeInTheDocument()
  })
})
