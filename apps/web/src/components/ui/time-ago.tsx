import { NUMERIC_DATE_TIME, useLocalDateFormatter } from '@/components/ui/local-date'

interface TimeAgoProps {
  date: Date | string
  className?: string
  /**
   * A locale both renders use exactly, e.g. `'en'` for a date inside
   * English-only copy. Leave it out to use the app's language.
   */
  locale?: string
}

/**
 * When something happened, as its date with the full timestamp as the
 * tooltip. Never a relative "17 days ago": that makes the reader work the
 * date out and dates nothing precisely (PRO-1664 follow-up). Formatted by
 * `useLocalDateFormatter`, so it hydrates cleanly and reads in the viewer's
 * regional format.
 */
export function TimeAgo({ date, className, locale }: TimeAgoProps) {
  const format = useLocalDateFormatter(locale)
  const label = format(date)
  if (!label) return null
  return (
    <span className={className} title={format(date, NUMERIC_DATE_TIME)}>
      {label}
    </span>
  )
}
