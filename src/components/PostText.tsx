import { Link } from 'react-router-dom'
import styles from './PostText.module.css'

/** Matches: explicit URLs, www. URLs, bare domains (e.g. example.com), and hashtags. */
const LINKIFY_REGEX =
  /(https?:\/\/[^\s<>"']+)|(www\.[^\s<>"'\],;:)!?]+)|(?<![@\/])((?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(?:\/[^\s<>"']*)?)|(#[\w]+)/gi

export interface PostTextProps {
  text: string
  className?: string
  /** Truncate to this many characters (e.g. 80 for cards). No truncation if undefined. */
  maxLength?: number
  /** Stop click propagation (use inside a card that is itself a link). */
  stopPropagation?: boolean
}

export default function PostText({ text, className, maxLength, stopPropagation }: PostTextProps) {
  const displayText = maxLength != null && text.length > maxLength ? text.slice(0, maxLength) + '…' : text
  const segments: Array<{ type: 'text' | 'url' | 'bareUrl' | 'hashtag'; value: string }> = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  const re = new RegExp(LINKIFY_REGEX.source, 'gi')
  while ((match = re.exec(displayText)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: displayText.slice(lastIndex, match.index) })
    }
    const value = match[1] ?? match[2] ?? match[3] ?? match[4]
    if (match[1]) {
      segments.push({ type: 'url', value })
    } else if (match[2] || match[3]) {
      segments.push({ type: 'bareUrl', value })
    } else {
      segments.push({ type: 'hashtag', value })
    }
    lastIndex = re.lastIndex
  }
  if (lastIndex < displayText.length) {
    segments.push({ type: 'text', value: displayText.slice(lastIndex) })
  }
  if (segments.length === 0) {
    return <span className={className}>{displayText}</span>
  }

  const onClick = stopPropagation ? (e: React.MouseEvent) => e.stopPropagation() : undefined

  return (
    <span className={className ?? undefined}>
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          return <span key={i}>{seg.value}</span>
        }
        if (seg.type === 'url') {
          const href = seg.value
          return (
            <a
              key={i}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.link}
              onClick={onClick}
            >
              {href}
            </a>
          )
        }
        if (seg.type === 'bareUrl') {
          const raw = seg.value.replace(/[.,;:)!?]+$/, '')
          const href = `https://${raw}`
          return (
            <a
              key={i}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.link}
              onClick={onClick}
            >
              {seg.value}
            </a>
          )
        }
        // hashtag: value is e.g. "#art" -> link to /tag/art
        const tagSlug = encodeURIComponent(seg.value.slice(1))
        return (
          <Link
            key={i}
            to={`/tag/${tagSlug}`}
            className={styles.hashtag}
            onClick={onClick}
          >
            {seg.value}
          </Link>
        )
      })}
    </span>
  )
}
