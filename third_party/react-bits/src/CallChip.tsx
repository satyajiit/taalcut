/*
 * CallChip, from React Bits (https://github.com/DavidHDev/react-bits)
 * at commit e2eb04d89d5be5a633dba7b2d4adfd274e053767,
 * src/ts-tailwind/Micro/CallChip/CallChip.tsx.
 * Copyright (c) 2026 David Haz. MIT + Commons Clause: see ../LICENSE.md.
 * Changed for Taalcut (styling, icons, motion, focus, i18n hooks): see the
 * "upstream" field in ../package.json; the original is in ../upstream/.
 */
'use client';

import React, { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  AudioLines,
  Check,
  File,
  Film,
  Pencil,
  RotateCcw,
  Search,
  Sparkles,
  SquareTerminal,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';

export type CallChipStatus = 'idle' | 'running' | 'done' | 'error';
export type CallChipIcon = 'terminal' | 'file' | 'search' | 'edit' | 'sparkles' | 'film' | 'audio' | 'wand';

/** Every string the chip says, so the app can translate them. English defaults. */
export interface CallChipLabels {
  /** What a screen reader hears when the status changes. `ms` is the elapsed time, if known. */
  describe: (name: string, argument: string, status: CallChipStatus, ms: number | null) => ReactNode;
  retry: (name: string, argument: string) => string;
}

export interface CallChipProps {
  icon?: CallChipIcon | ReactNode;
  name?: string;
  argument?: string;
  status?: CallChipStatus;
  expectedMs?: number;
  size?: number;
  radius?: number | string;
  color?: string;
  surfaceColor?: string;
  progressColor?: string;
  progressOpacity?: number;
  doneColor?: string;
  errorColor?: string;
  washOpacity?: number;
  shake?: number;
  showTimer?: boolean;
  /** Formats the timer, e.g. with Intl. Default: '420 ms' / '12.3 s'. */
  formatElapsed?: (ms: number) => string;
  /** When the work began (epoch ms): the timer counts from then, not from when the status last turned running. */
  startedAt?: number;
  labels?: Partial<CallChipLabels>;
  onRetry?: () => void;
  className?: string;
  style?: CSSProperties;
}

type Glyph = 'tool' | 'check' | 'retry';

const HOLD_AT = 0.9;
const SHAKE = [0, -1, 1, -0.66, 0.66, -0.33, 0];
const ICONS: Record<CallChipIcon, LucideIcon> = {
  terminal: SquareTerminal,
  file: File,
  search: Search,
  edit: Pencil,
  sparkles: Sparkles,
  film: Film,
  audio: AudioLines,
  wand: WandSparkles,
};
const WORDS: Record<CallChipStatus, string> = { running: 'running', done: 'done', error: 'failed', idle: 'queued' };
const DEFAULT_LABELS: CallChipLabels = {
  describe: (name, argument, status, ms) =>
    `${name} ${argument}, ${WORDS[status] ?? status}${
      ms !== null && status === 'done' ? ` in ${ms} ms` : ms !== null && status === 'error' ? ` after ${ms} ms` : ''
    }`,
  retry: (name, argument) => `Retry ${name} ${argument}`
};

const fmt = (ms: number) => (ms < 10000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const glyphOf = (s: CallChipStatus): Glyph => (s === 'done' ? 'check' : s === 'error' ? 'retry' : 'tool');

// Taalcut: glyphs roll with opacity and transform only (no blur filter), on the motion tokens.
const GLYPH =
  'absolute inset-0 grid place-items-center opacity-0 [transform:translateY(70%)] data-[state=in]:opacity-100 data-[state=in]:[transform:none] data-[state=in]:[transition:opacity_220ms_var(--ease-out),transform_220ms_var(--ease-out)] data-[state=out]:[transform:translateY(-70%)] data-[state=out]:[transition:opacity_160ms_var(--ease-in),transform_160ms_var(--ease-in)] group-data-[status=done]:data-[state=in]:[color:var(--cc-done)] group-data-[status=error]:data-[state=in]:[color:var(--cc-error)] motion-reduce:[transform:none]! group-not-data-[mounted]:transition-none!';

const CallChip: React.FC<CallChipProps> = ({
  icon = 'terminal',
  name = '',
  argument = '',
  status = 'running',
  expectedMs = 2500,
  size = 28,
  radius = 'var(--radius-md)',
  color = 'currentColor',
  surfaceColor = 'var(--color-sunken)',
  progressColor = 'currentColor',
  progressOpacity = 0.08,
  doneColor = 'var(--color-success-strong)',
  errorColor = 'var(--color-danger-strong)',
  washOpacity = 0.14,
  shake = 0,
  showTimer = true,
  formatElapsed,
  startedAt: since,
  labels: labelOverrides,
  onRetry,
  className = '',
  style
}) => {
  const labels: CallChipLabels = { ...DEFAULT_LABELS, ...labelOverrides };
  const rootRef = useRef<HTMLSpanElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<HTMLSpanElement>(null);
  const mountedRef = useRef(false);
  const fraction = useRef(0);
  const clock = useRef({ ms: 0 });
  const shakeAnim = useRef<Animation | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;
  const format = useRef(formatElapsed);
  format.current = formatElapsed;
  const sinceRef = useRef(since);
  sinceRef.current = since;
  const [mounted, setMounted] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [announce, setAnnounce] = useState<ReactNode>('');
  const roll = useRef<{ cur: Glyph; prev: Glyph | null }>({ cur: glyphOf(status), prev: null });
  if (glyphOf(status) !== roll.current.cur) roll.current = { cur: glyphOf(status), prev: roll.current.cur };

  const setFraction = (f: number, instant: boolean) => {
    const fill = fillRef.current;
    if (!fill) return;
    fraction.current = f;
    if (instant) fill.style.transition = 'none';
    fill.style.transform = `scaleX(${f})`;
    if (instant) {
      void fill.getBoundingClientRect();
      fill.style.transition = '';
    }
  };
  const apply = (s: CallChipStatus, animate: boolean) => {
    if (s === 'running') {
      shakeAnim.current?.cancel();
      setFraction(0, true);
      if (animate) setFraction(HOLD_AT, false);
    } else if (s === 'done') {
      setFraction(1, !animate);
    } else if (s === 'error') {
      const fill = fillRef.current;
      // Where the fill is right now (DOMMatrix is missing outside browsers, e.g. in tests).
      const live =
        fill && typeof DOMMatrix === 'function'
          ? new DOMMatrix(getComputedStyle(fill).transform).a
          : fraction.current;
      setFraction(Math.min(1, Math.max(0, live)), true);
      if (animate && shake > 0 && !reduceMotion() && rootRef.current) {
        shakeAnim.current = rootRef.current.animate(
          SHAKE.map(k => ({ transform: `translateX(${k * shake}px)`, easing: 'cubic-bezier(0.65, 0, 0.35, 1)' })),
          { duration: 420, composite: 'add' }
        );
      }
    } else setFraction(0, true);
  };

  useEffect(() => {
    mountedRef.current = true;
    setMounted(true);
    apply(statusRef.current, statusRef.current === 'running');
    return () => {
      mountedRef.current = false;
      shakeAnim.current?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLayoutEffect(() => {
    if (mountedRef.current) apply(status, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    const write = (ms: number) => {
      clock.current.ms = ms;
      if (timerRef.current) timerRef.current.textContent = (format.current ?? fmt)(ms);
    };
    if (status !== 'running') {
      if ((status === 'idle' || !clock.current.ms) && timerRef.current) timerRef.current.textContent = '—';
      return undefined;
    }
    // Taalcut: a known start (a group of calls) carries the clock across its pauses instead of starting at zero.
    const startedAt = performance.now() - (sinceRef.current === undefined ? 0 : Math.max(0, Date.now() - sinceRef.current));
    write(performance.now() - startedAt);
    if (reduceMotion()) {
      const id = setInterval(() => write(performance.now() - startedAt), 100);
      return () => {
        clearInterval(id);
        write(performance.now() - startedAt);
      };
    }
    let raf = 0;
    const tick = () => {
      write(performance.now() - startedAt);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      write(performance.now() - startedAt);
    };
  }, [status]);
  useEffect(() => {
    const ms = showTimer && clock.current.ms ? Math.round(clock.current.ms) : null;
    setAnnounce(labels.describe(name, argument, status, ms));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const font = Math.max(11, Math.round(size * 0.44));
  const glyphState = (g: Glyph) => (g === roll.current.cur ? 'in' : g === roll.current.prev ? 'out' : undefined);
  const ToolIcon = typeof icon === 'string' ? (ICONS[icon as CallChipIcon] ?? ICONS.terminal) : null;
  const iconSize = font + 2;

  return (
    <span
      ref={rootRef}
      role="status"
      aria-busy={status === 'running' || undefined}
      data-status={status}
      data-mounted={mounted ? '' : undefined}
      data-pressed={pressed ? '' : undefined}
      className={`group relative box-border inline-flex max-w-full items-center overflow-hidden leading-none whitespace-nowrap select-none [-webkit-touch-callout:none] [height:var(--cc-size)] [padding:0_var(--cc-pad)] [gap:var(--cc-gap)] [border-radius:var(--cc-radius)] [background:var(--cc-surface)] [color:var(--cc-color)] [font-size:var(--cc-font)] [transition:transform_120ms_var(--ease-out)] data-[status=error]:has-[button]:cursor-pointer data-[pressed]:scale-[0.97] has-[button:focus-visible]:outline-2 has-[button:focus-visible]:outline-solid has-[button:focus-visible]:outline-offset-2 has-[button:focus-visible]:outline-(--color-focus) window-inactive:has-[button:focus-visible]:outline-transparent motion-reduce:data-[pressed]:scale-100${className ? ` ${className}` : ''}`}
      style={
        {
          '--cc-size': `${size}px`,
          '--cc-font': `${font}px`,
          '--cc-pad': `${Math.round(size * 0.35)}px`,
          '--cc-gap': `${Math.round(font * 0.55)}px`,
          '--cc-radius': typeof radius === 'number' ? `${radius}px` : radius,
          '--cc-color': color,
          '--cc-surface': surfaceColor,
          '--cc-progress': progressColor,
          '--cc-progress-pct': `${progressOpacity * 100}%`,
          '--cc-done': doneColor,
          '--cc-error': errorColor,
          '--cc-wash-pct': `${washOpacity * 100}%`,
          '--cc-expected': `${expectedMs}ms`,
          ...style
        } as CSSProperties
      }
    >
      <span
        ref={fillRef}
        className="pointer-events-none absolute inset-0 origin-left scale-x-0 [clip-path:inset(0_0_0_0)] [background:color-mix(in_srgb,var(--cc-progress)_var(--cc-progress-pct),transparent)] group-data-[status=running]:[transition:transform_var(--cc-expected)_linear] group-data-[status=done]:[clip-path:inset(100%_0_0_0)] group-data-[status=done]:[background:color-mix(in_srgb,var(--cc-done)_var(--cc-wash-pct),transparent)] group-data-[status=done]:[transition:transform_220ms_var(--ease-out),background-color_120ms_var(--ease-out),clip-path_420ms_var(--ease-out)_220ms] group-data-[status=error]:[background:color-mix(in_srgb,var(--cc-error)_var(--cc-wash-pct),transparent)] group-data-[status=error]:[transition:background-color_220ms_var(--ease-out)] motion-reduce:group-data-[status=done]:[clip-path:inset(0_0_0_0)] motion-reduce:group-data-[status=done]:[transition:background-color_120ms_linear] group-not-data-[mounted]:transition-none!"
        aria-hidden="true"
      />
      <span
        className="relative flex-none [contain:paint] [width:calc(var(--cc-font)+2px)] [height:calc(var(--cc-font)+2px)]"
        aria-hidden="true"
      >
        <span className={GLYPH} data-state={glyphState('tool')}>
          {ToolIcon ? <ToolIcon size={iconSize} strokeWidth={1.8} /> : icon}
        </span>
        <span className={GLYPH} data-state={glyphState('check')}>
          <Check size={iconSize} strokeWidth={2.2} />
        </span>
        <span className={GLYPH} data-state={glyphState('retry')}>
          <RotateCcw size={iconSize} strokeWidth={2} />
        </span>
      </span>
      <span className="relative font-medium" aria-hidden="true">
        {name}
      </span>
      {argument ? (
        <span className="relative min-w-0 truncate" aria-hidden="true" data-user-content="">
          {argument}
        </span>
      ) : null}
      {showTimer ? (
        <span
          ref={timerRef}
          className="relative min-w-[6ch] text-right font-mono tabular-nums"
          aria-hidden="true"
        >
          —
        </span>
      ) : null}
      {status === 'error' && onRetry ? (
        <button
          type="button"
          className="absolute inset-0 m-0 cursor-pointer touch-manipulation appearance-none border-0 bg-transparent p-0 outline-none [border-radius:var(--cc-radius)] [-webkit-tap-highlight-color:transparent]"
          aria-label={labels.retry(name, argument)}
          onClick={() => onRetry()}
          onPointerDown={() => setPressed(true)}
          onPointerUp={() => setPressed(false)}
          onPointerCancel={() => setPressed(false)}
        />
      ) : null}
      <span className="sr-only">{announce}</span>
    </span>
  );
};

export default CallChip;
