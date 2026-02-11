import styles from './CharacterCountWithCircle.module.css'

const CIRCLE_R = 10
const CIRCLE_C = 2 * Math.PI * CIRCLE_R

export default function CharacterCountWithCircle({
  used,
  max,
  className,
}: {
  used: number
  max: number
  className?: string
}) {
  const remaining = Math.max(0, max - used)
  const ratio = max > 0 ? used / max : 0
  const dashOffset = CIRCLE_C * (1 - ratio)
  return (
    <div
      className={`${styles.wrap} ${className ?? ''}`}
      aria-live="polite"
      data-low={remaining > 0 && remaining <= 20 ? 'true' : undefined}
      data-zero={remaining === 0 ? 'true' : undefined}
    >
      <span className={styles.count}>{remaining}</span>
      <svg className={styles.circle} viewBox={`0 0 ${CIRCLE_R * 2 + 4} ${CIRCLE_R * 2 + 4}`} aria-hidden>
        <circle
          className={styles.circleBg}
          cx={CIRCLE_R + 2}
          cy={CIRCLE_R + 2}
          r={CIRCLE_R}
          fill="none"
        />
        <circle
          className={styles.circleBar}
          cx={CIRCLE_R + 2}
          cy={CIRCLE_R + 2}
          r={CIRCLE_R}
          fill="none"
          strokeDasharray={CIRCLE_C}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${CIRCLE_R + 2} ${CIRCLE_R + 2})`}
        />
      </svg>
    </div>
  )
}
