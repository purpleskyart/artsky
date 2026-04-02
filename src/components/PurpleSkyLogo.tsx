import { useId } from 'react'

/**
 * Symmetrical bee mark (striped abdomen, waist, stinger) — same artwork as public/icon.svg / icon-pwa.svg.
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
      width={28}
      height={28}
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
      </defs>
      <g transform="translate(256 256) scale(1.12 1) translate(-256 -256)">
        <defs>
          <clipPath id={clipAbdomenId}>
            <ellipse cx={256} cy={338} rx={68} ry={88} />
          </clipPath>
        </defs>
        {/* wings (behind body) */}
        <g fill={`url(#${gradId})`}>
          <ellipse cx={156} cy={214} rx={90} ry={54} transform="rotate(-34 156 214)" />
          <ellipse cx={356} cy={214} rx={90} ry={54} transform="rotate(34 356 214)" />
        </g>
        {/* stinger */}
        <path fill={`url(#${gradId})`} d="M256 408 L228 434 L284 434 Z" />
        {/* abdomen + thorax + waist + head */}
        <g fill={`url(#${gradId})`}>
          <ellipse cx={256} cy={338} rx={68} ry={88} />
          <ellipse cx={256} cy={262} rx={28} ry={18} />
          <ellipse cx={256} cy={206} rx={50} ry={46} />
          <circle cx={256} cy={110} r={56} />
        </g>
        {/* abdomen stripes (bee cue) */}
        <g clipPath={`url(#${clipAbdomenId})`}>
          <rect x={188} y={282} width={136} height={14} fill={stripeFill} />
          <rect x={188} y={312} width={136} height={14} fill={stripeFill} />
          <rect x={188} y={342} width={136} height={14} fill={stripeFill} />
          <rect x={188} y={372} width={136} height={14} fill={stripeFill} />
        </g>
        {/* antennae */}
        <g fill="none" strokeWidth={14} strokeLinecap="round" strokeLinejoin="round">
          <path stroke={`url(#${gradId})`} d="M232 82 Q 205 52 188 38" />
          <path stroke={`url(#${gradId})`} d="M280 82 Q 307 52 324 38" />
        </g>
        <g fill={`url(#${gradId})`}>
          <circle cx={188} cy={38} r={9} />
          <circle cx={324} cy={38} r={9} />
        </g>
      </g>
    </svg>
  )
}
