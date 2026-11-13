/*
 * StatusMark, from React Bits (https://github.com/DavidHDev/react-bits)
 * at commit e2eb04d89d5be5a633dba7b2d4adfd274e053767,
 * src/ts-tailwind/Micro/StatusMark/StatusMark.tsx.
 * Copyright (c) 2026 David Haz. MIT + Commons Clause: see ../LICENSE.md.
 * Changed for Taalcut (styling, CSP, motion, i18n hooks): see the "upstream"
 * field in ../package.json; the original is in ../upstream/.
 */
'use client';

import React, { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { animate, useMotionValue, useReducedMotion } from 'motion/react';

export type StatusMarkStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

export interface StatusMarkProps {
  status?: StatusMarkStatus;
  progress?: number;
  label?: ReactNode;
  /** Spoken status words, so the app can translate them. English defaults. */
  labels?: Partial<Record<StatusMarkStatus, string>>;
  /** Formats the spoken progress, e.g. with Intl. Default: '42%'. */
  formatProgress?: (fraction: number) => string;
  color?: string;
  doneColor?: string;
  errorColor?: string;
  size?: number;
  strokeWidth?: number;
  dashes?: number;
  /** Pixels, or any CSS length such as a token: 'var(--text-base)'. */
  fontSize?: number | string;
  spinDuration?: number;
  arcLength?: number;
  drawDuration?: number;
  fillOpacity?: number;
  strike?: boolean;
  strikeDelay?: number;
  className?: string;
  style?: CSSProperties;
}

// Taalcut: a tween on the ease-out token instead of a spring (DESIGN.md: springs only for drags).
const UI = { duration: 0.22, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] };
const MORPH = { duration: 0.22, ease: [0.65, 0, 0.35, 1] as [number, number, number, number] };
const CHECK = 'M7.5 12.25 10.5 15.25 16.75 8.75';
const CROSS = 'M8.5 8.5 15.5 15.5M15.5 8.5 8.5 15.5';
const TEXT: Record<StatusMarkStatus, string> = {
  pending: 'Pending',
  running: 'In progress',
  done: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled'
};
const IDLE_DASH = 0.3;
// The sm-breathe keyframes live in react-bits.css: the app's CSP (style-src 'self') blocks inline <style>.

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const StatusMark: React.FC<StatusMarkProps> = ({
  status = 'pending',
  progress,
  label,
  labels,
  formatProgress,
  color = 'currentColor',
  doneColor = 'var(--color-success-strong)',
  errorColor = 'var(--color-danger-strong)',
  size = 20,
  strokeWidth = 2,
  dashes = 8,
  fontSize = 14,
  spinDuration = 1100,
  arcLength = 0.68,
  drawDuration = 220,
  fillOpacity = 0.06,
  strike = true,
  strikeDelay = 60,
  className = '',
  style
}) => {
  const reduce = useReducedMotion();
  const r = 10 - strokeWidth / 2;
  const C = 2 * Math.PI * r;
  const P = C / Math.max(1, dashes);
  const determinate = status === 'running' && typeof progress === 'number' && Number.isFinite(progress);
  const indeterminate = status === 'running' && !determinate;
  const solid = status === 'running' || status === 'done' || status === 'failed';
  const targetArc = indeterminate ? arcLength : determinate ? clamp01(progress as number) : 1;

  const mode = useMotionValue(solid ? 1 : 0);
  const arc = useMotionValue(targetArc);
  const travel = useMotionValue(0);
  const ringRef = useRef<SVGCircleElement>(null);
  const geo = useRef({ C, P });
  geo.current = { C, P };
  const gen = useRef(0);

  const writeDash = () => {
    const g = geo.current;
    const m = mode.get();
    const a = arc.get();
    const dash = IDLE_DASH * g.P + (a * g.C - IDLE_DASH * g.P) * m;
    const gap = (1 - IDLE_DASH) * g.P + ((1 - a) * g.C - (1 - IDLE_DASH) * g.P) * m;
    ringRef.current?.setAttribute('stroke-dasharray', `${Math.max(0, dash)} ${Math.max(0, gap)}`);
  };
  useLayoutEffect(() => {
    writeDash();
    ringRef.current?.setAttribute('stroke-dashoffset', String(travel.get()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [C, P]);
  useEffect(() => {
    const offs = [
      mode.on('change', writeDash),
      arc.on('change', writeDash),
      travel.on('change', (v: number) => ringRef.current?.setAttribute('stroke-dashoffset', String(v)))
    ];
    return () => {
      offs.forEach(off => off());
      mode.stop();
      arc.stop();
      travel.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const g = ++gen.current;
    if (reduce) {
      mode.jump(solid ? 1 : 0);
      arc.jump(targetArc);
      travel.jump(0);
      return;
    }
    if (mode.get() === 0) arc.jump(targetArc);
    animate(mode, solid ? 1 : 0, MORPH);
    animate(arc, targetArc, UI);
    if (indeterminate) {
      const t0 = travel.get();
      animate(travel, [t0, t0 - C], { duration: spinDuration / 1000, ease: 'linear', repeat: Infinity });
      return;
    }
    const unit = determinate ? C : P;
    const to = Math.floor(travel.get() / unit) * unit;
    animate(travel, to, UI).then(() => {
      if (gen.current === g) travel.jump(0);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, determinate, targetArc, reduce, C, P, spinDuration]);

  const words = { ...TEXT, ...labels };
  const fraction = clamp01((progress as number) ?? 0);
  const spoken =
    words[status] +
    (determinate ? `, ${formatProgress ? formatProgress(fraction) : `${Math.round(fraction * 100)}%`}` : '');
  const hasLabel = label !== undefined && label !== null;

  return (
    <span
      className={`group relative inline-flex items-center align-middle leading-none [gap:calc(var(--sm-size)*0.5)]${className ? ` ${className}` : ''}`}
      data-status={status}
      data-indeterminate={indeterminate ? '' : undefined}
      data-strike={strike ? '' : undefined}
      style={
        {
          '--sm-size': `${size}px`,
          '--sm-stroke': strokeWidth,
          '--sm-color': color,
          '--sm-done': doneColor,
          '--sm-error': errorColor,
          '--sm-fill': fillOpacity,
          '--sm-font': typeof fontSize === 'number' ? `${fontSize}px` : fontSize,
          '--sm-draw': `${drawDuration}ms`,
          '--sm-strike-delay': `${120 + strikeDelay}ms`,
          '--sm-check-delay': '120ms',
          ...style
        } as CSSProperties
      }
    >
      <svg
        className="shrink-0 overflow-visible [color:var(--sm-color)] [transition:color_200ms_var(--ease-out)] group-data-[status=done]:[color:var(--sm-done)] group-data-[status=failed]:[color:var(--sm-error)]"
        viewBox="0 0 24 24"
        width={size}
        height={size}
        role={hasLabel ? undefined : 'img'}
        aria-label={hasLabel ? undefined : spoken}
        aria-hidden={hasLabel || undefined}
      >
        <circle
          className="[fill:currentColor] [stroke:currentColor] [stroke-width:var(--sm-stroke)] [fill-opacity:0] [stroke-opacity:0] [transition:fill-opacity_180ms_var(--ease-out),stroke-opacity_200ms_var(--ease-out)] group-data-[status=running]:[stroke-opacity:0.2] group-data-[status=done]:[fill-opacity:var(--sm-fill)] group-data-[status=failed]:[fill-opacity:var(--sm-fill)]"
          cx="12"
          cy="12"
          r={r}
          transform="rotate(-90 12 12)"
        />
        <circle
          ref={ringRef}
          className="fill-none [stroke:currentColor] [stroke-width:var(--sm-stroke)] [stroke-linecap:round] opacity-[0.55] [transition:opacity_200ms_var(--ease-out)] group-data-[status=running]:opacity-100 group-data-[status=done]:opacity-100 group-data-[status=failed]:opacity-100 motion-reduce:group-data-[indeterminate]:animate-[sm-breathe_2100ms_var(--ease-in-out)_infinite]"
          cx="12"
          cy="12"
          r={r}
          transform="rotate(-90 12 12)"
        />
        <path
          className="fill-none [stroke:currentColor] [stroke-width:var(--sm-stroke)] [stroke-linecap:round] [stroke-linejoin:round] [stroke-dasharray:1_2] [stroke-dashoffset:1.05] opacity-0 [transition:stroke-dashoffset_160ms_var(--ease-out),opacity_0ms_linear_160ms] group-data-[status=done]:[stroke-dashoffset:0] group-data-[status=done]:opacity-100 group-data-[status=done]:[transition:stroke-dashoffset_var(--sm-draw)_var(--ease-out)_var(--sm-check-delay),opacity_0ms_linear_var(--sm-check-delay)] motion-reduce:[stroke-dashoffset:0] motion-reduce:[transition:opacity_150ms_linear] motion-reduce:group-data-[status=done]:[transition:opacity_150ms_linear]"
          d={CHECK}
          pathLength="1"
        />
        <path
          className="fill-none [stroke:currentColor] [stroke-width:var(--sm-stroke)] [stroke-linecap:round] [stroke-linejoin:round] [stroke-dasharray:1_2] [stroke-dashoffset:1.05] opacity-0 [transition:stroke-dashoffset_160ms_var(--ease-out),opacity_0ms_linear_160ms] group-data-[status=failed]:[stroke-dashoffset:0] group-data-[status=failed]:opacity-100 group-data-[status=failed]:[transition:stroke-dashoffset_var(--sm-draw)_var(--ease-out)_var(--sm-check-delay),opacity_0ms_linear_var(--sm-check-delay)] group-data-[status=cancelled]:[stroke-dashoffset:0] group-data-[status=cancelled]:opacity-100 group-data-[status=cancelled]:[transition:stroke-dashoffset_var(--sm-draw)_var(--ease-out)_var(--sm-check-delay),opacity_0ms_linear_var(--sm-check-delay)] motion-reduce:[stroke-dashoffset:0] motion-reduce:[transition:opacity_150ms_linear] motion-reduce:group-data-[status=failed]:[transition:opacity_150ms_linear] motion-reduce:group-data-[status=cancelled]:[transition:opacity_150ms_linear]"
          d={CROSS}
          pathLength="1"
        />
      </svg>
      {hasLabel ? <span className="sr-only">{spoken}: </span> : null}
      {hasLabel ? (
        <span className="relative leading-[1.25] opacity-[0.65] [color:var(--sm-color)] [font-size:var(--sm-font)] [transition:opacity_200ms_var(--ease-out)] group-data-[status=running]:opacity-100 group-data-[status=done]:opacity-60 group-data-[status=failed]:opacity-100 group-data-[status=cancelled]:opacity-[0.55]">
          {label}
          <span
            className="pointer-events-none absolute inset-x-0 top-1/2 origin-left scale-x-0 bg-current [translate:0_-50%] [height:max(1px,calc(var(--sm-font)/14))] [transition:transform_160ms_var(--ease-out)] group-data-[status=done]:group-data-[strike]:scale-x-100 group-data-[status=done]:group-data-[strike]:[transition:transform_280ms_var(--ease-out)_var(--sm-strike-delay)] motion-reduce:scale-x-100! motion-reduce:opacity-0 motion-reduce:[transition:opacity_150ms_linear] motion-reduce:group-data-[status=done]:group-data-[strike]:opacity-100 motion-reduce:group-data-[status=done]:group-data-[strike]:[transition:opacity_150ms_linear]"
            aria-hidden="true"
          />
        </span>
      ) : null}
    </span>
  );
};

export default StatusMark;
