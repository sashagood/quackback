import { useEffect, useRef, useState } from 'react'
import { format, formatDistanceToNow } from 'date-fns'

interface TimeAgoProps {
  date: Date | string
  className?: string
}

/**
 * How long a label stays relative ("3 days ago"). Past this the reader can no
 * longer place the moment without subtracting, and a relative label dates
 * nothing precisely, so the label becomes the absolute date instead.
 */
const RELATIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

function toDate(date: Date | string | null | undefined): Date | null {
  if (!date) return null
  const d = typeof date === 'string' ? new Date(date) : date
  return isNaN(d.getTime()) ? null : d
}

/** The label `<TimeAgo>` renders, for static (no-interval) consumers like
 *  CitationFreshness: relative inside the first week ("3 days ago"), the
 *  absolute date from then on ("20 October 2026"); '' for a missing or
 *  invalid date. */
export function getTimeAgo(date: Date | string | null | undefined): string {
  const d = toDate(date)
  if (!d) return ''
  // Elapsed time, not calendar days: date-fns's day difference shifts by one
  // across a DST change, which would move the cutoff with the viewer's zone.
  if (Math.abs(Date.now() - d.getTime()) >= RELATIVE_WINDOW_MS) {
    return format(d, 'd MMMM yyyy')
  }
  return formatDistanceToNow(d, { addSuffix: true })
}

/** The full timestamp, shown as the label's tooltip whichever form it takes. */
export function getFullTimestamp(date: Date | string | null | undefined): string {
  const d = toDate(date)
  return d ? format(d, 'd MMMM yyyy, HH:mm') : ''
}

export function TimeAgo({ date, className }: TimeAgoProps) {
  // Initialize with computed value for SSR
  const [timeAgo, setTimeAgo] = useState<string>(() => getTimeAgo(date))
  // The server's label and the hydrating browser's can straddle a boundary
  // ("59 minutes ago", "about 1 hour ago"). Hydration keeps the server's text
  // without complaint, and a changed key replaces it once mounted.
  const [remount, setRemount] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    // Update immediately in case server/client time differs slightly
    const label = getTimeAgo(date)
    setTimeAgo(label)
    if (ref.current && ref.current.textContent !== label) setRemount((n) => n + 1)

    // Update every minute
    const interval = setInterval(() => {
      setTimeAgo(getTimeAgo(date))
    }, 60000)

    return () => clearInterval(interval)
  }, [date])

  return (
    <span
      key={remount}
      ref={ref}
      className={className}
      title={getFullTimestamp(date)}
      suppressHydrationWarning
    >
      {timeAgo}
    </span>
  )
}
