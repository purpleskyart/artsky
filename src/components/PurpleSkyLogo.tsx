import { useId } from 'react'

/**
 * Symmetrical bee mark (striped abdomen, waist, stinger, eyes) — same palette as public/icon.svg.
 * Inline so the header is not stuck on a cached asset.
 */
export default function PurpleSkyLogo({ className }: { className?: string }) {
  const uid = useId().replace(/:/g, '')
  const gradId = `artsky-purple-${uid}`
  const clipAbdomenId = `abdomen-${uid}`
  const stripeFill = '#3d2572'

  return (
    <svg
      className={className}
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      shapeRendering="geometricPrecision"
      fillRule="evenodd"
      clipRule="evenodd"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8B52EE" />
          <stop offset="100%" stopColor="#7D55FC" />
        </linearGradient>
        <clipPath id={clipAbdomenId}>
          <ellipse cx={256} cy={334} rx={58} ry={80} />
        </clipPath>
      </defs>
      {/* wings (behind body) */}
      <g fill={`url(#${gradId})`}>
        <ellipse cx={156} cy={214} rx={104} ry={62} transform="rotate(-34 156 214)" />
        <ellipse cx={356} cy={214} rx={104} ry={62} transform="rotate(34 356 214)" />
      </g>
      {/* stinger */}
      <path fill={`url(#${gradId})`} d="M256 396 L236 432 L276 432 Z" />
      {/* abdomen + thorax + waist + head */}
      <g fill={`url(#${gradId})`}>
        <ellipse cx={256} cy={334} rx={58} ry={80} />
        <ellipse cx={256} cy={262} rx={28} ry={18} />
        <ellipse cx={256} cy={206} rx={50} ry={46} />
        <circle cx={256} cy={118} r={48} />
      </g>
      {/* abdomen stripes (bee cue) */}
      <g clipPath={`url(#${clipAbdomenId})`}>
        <rect x={190} y={278} width={132} height={14} fill={stripeFill} />
        <rect x={190} y={308} width={132} height={14} fill={stripeFill} />
        <rect x={190} y={338} width={132} height={14} fill={stripeFill} />
        <rect x={190} y={368} width={132} height={14} fill={stripeFill} />
      </g>
      {/* eyes */}
      <circle cx={228} cy={112} r={11} fill="#1a0f32" />
      <circle cx={284} cy={112} r={11} fill="#1a0f32" />
      {/* antennae */}
      <g fill="none" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round">
        <path stroke={`url(#${gradId})`} d="M232 82 Q 205 52 188 38" />
        <path stroke={`url(#${gradId})`} d="M280 82 Q 307 52 324 38" />
      </g>
      <g fill={`url(#${gradId})`}>
        <circle cx={188} cy={38} r={7} />
        <circle cx={324} cy={38} r={7} />
      </g>
    </svg>
  )
}
