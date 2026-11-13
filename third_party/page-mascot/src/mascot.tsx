/*
 * Mascot, from page-mascot (https://github.com/nilbuild/page-mascot)
 * at commit 76a44ed9180063bf4852b9dd724b656f4a828ac7, src/mascot.tsx.
 * Copyright (c) 2026 Kamran Ahmed. MIT: see ../LICENSE.
 * Changed for Taalcut: the sprite stage only (any number of 3x3 sheets, one frame
 * shown, the pointer's direction and a poke reported to the caller, no button). What
 * it shows and when belongs to the caller: see the "upstream" field in
 * ../package.json; the original is in ../upstream/.
 */
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode, Ref } from 'react'

export const DIRECTIONS = [
  'up-left',
  'up',
  'up-right',
  'left',
  'center',
  'right',
  'down-left',
  'down',
  'down-right',
] as const

export type MascotDirection = (typeof DIRECTIONS)[number]

/** One drawing: which sheet, and which of its nine cells (left to right, top to bottom). */
export type MascotFrame = { sheet: number; cell: number }

// Clockwise from the right, matching atan2 with y pointing down.
const CLOCKWISE: readonly MascotDirection[] = [
  'right',
  'down-right',
  'down',
  'down-left',
  'left',
  'up-left',
  'up',
  'up-right',
]
const SECTOR = (Math.PI * 2) / CLOCKWISE.length
const HYSTERESIS = 0.12
const DEAD_ZONE = 70

// background-size 300% makes each cell a clean 0/50/100% step on both axes.
function cell(index: number): CSSProperties {
  return { backgroundPosition: `${(index % 3) * 50}% ${Math.floor(index / 3) * 50}%` }
}

function wrap(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

function matches(query: string): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(query).matches
}

// Only opacity may ever transition. A page-wide rule that gives every transition a
// duration (Taalcut's reduced-motion base layer does) would otherwise slide the sheet
// through the frames between two head turns.
const layer: CSSProperties = {
  position: 'absolute',
  inset: 0,
  backgroundSize: '300% 300%',
  backgroundRepeat: 'no-repeat',
  transitionProperty: 'opacity',
}

export type MascotProps = {
  /** The 3x3 sheets, as served paths or imported images. All are fetched up front. */
  sheets: readonly string[]
  /** The drawing to show. */
  frame: MascotFrame
  size?: number
  className?: string
  /**
   * What a screen reader calls it (an image with this name). Leave it out where
   * the mascot is decorative: it is then hidden from assistive tech.
   */
  label?: string
  /** Report where the pointer is, as one of the nine directions, while true (fine pointers only). */
  track?: boolean
  onLook?: (direction: MascotDirection) => void
  /** A click or tap on the drawing. */
  onPoke?: () => void
  /** The pointer came onto the drawing (true) or left it (false). */
  onHover?: (over: boolean) => void
  /** The element inside the root that body motions (a hop, a sway) may animate. */
  stageRef?: Ref<HTMLSpanElement>
  /** data-* attributes for the root, for tests and styling. */
  data?: Record<`data-${string}`, string | undefined>
  children?: ReactNode
}

export function Mascot(props: MascotProps) {
  const {
    sheets,
    frame,
    size = 140,
    className,
    label,
    track = true,
    onLook,
    onPoke,
    onHover,
    stageRef,
    data,
    children,
  } = props

  const rootRef = useRef<HTMLSpanElement>(null)
  const lookRef = useRef(onLook)
  // The frame shown before this one: its sheet keeps it while the two crossfade.
  const [shown, setShown] = useState({ now: frame, before: frame })
  if (shown.now.sheet !== frame.sheet || shown.now.cell !== frame.cell) {
    setShown({ now: frame, before: shown.now })
  }

  useEffect(() => {
    lookRef.current = onLook
  }, [onLook])

  useEffect(() => {
    if (!track || !matches('(hover: hover) and (pointer: fine)')) {
      return
    }

    let sector = -1
    let pointer: { x: number; y: number } | null = null

    const aim = () => {
      const root = rootRef.current
      if (!root || !pointer) {
        return
      }

      const box = root.getBoundingClientRect()
      const dx = pointer.x - (box.left + box.width / 2)
      const dy = pointer.y - (box.top + box.height / 2)

      if (Math.hypot(dx, dy) < DEAD_ZONE) {
        sector = -1
        lookRef.current?.('center')
        return
      }

      // Hold the current sector until the pointer is well past its edge.
      const angle = Math.atan2(dy, dx)
      if (sector !== -1 && Math.abs(wrap(angle - sector * SECTOR)) < SECTOR / 2 + HYSTERESIS) {
        return
      }

      sector = (Math.round(angle / SECTOR) + CLOCKWISE.length) % CLOCKWISE.length
      lookRef.current?.(CLOCKWISE[sector] ?? 'center')
    }

    const onPointerMove = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY }
      aim()
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('scroll', aim, { passive: true })

    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('scroll', aim)
    }
  }, [track])

  // Inline styles so the file drops into any project without a CSS framework.
  // React writes them through the CSSOM, which a style-src 'self' policy allows.
  return (
    <span
      ref={rootRef}
      className={className}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      {...data}
      onClick={onPoke}
      onPointerEnter={onHover ? () => onHover(true) : undefined}
      onPointerLeave={onHover ? () => onHover(false) : undefined}
      style={{
        position: 'relative',
        display: 'block',
        flexShrink: 0,
        width: size,
        height: size,
        cursor: 'pointer',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      <span
        ref={stageRef}
        style={{
          position: 'relative',
          display: 'block',
          width: '100%',
          height: '100%',
          transformOrigin: '50% 75%',
        }}
      >
        {/* Every sheet stays mounted, so each is fetched up front, never on the first poke. */}
        {sheets.map((url, index) => (
          <span
            key={url}
            style={{
              ...layer,
              backgroundImage: `url("${url}")`,
              ...cell(
                index === shown.now.sheet
                  ? shown.now.cell
                  : index === shown.before.sheet
                    ? shown.before.cell
                    : 4,
              ),
              opacity: index === shown.now.sheet ? 1 : 0,
            }}
          />
        ))}
        {children}
      </span>
    </span>
  )
}
