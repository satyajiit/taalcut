// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: code-slots (React Bits micro/code-slots adaptation) · genre: atmospheric studio app
 * system: DESIGN.md v0.3 · motion: digits rise into their slots in a short cascade (scale wash + vertical rise),
 * tweens on --dur-short and --ease-out with no bounce (UX1: the springs went), a gliding caret between slots, a
 * reverse cascade drain on error, a wash on success. The slot under the caret carries the base focus ring.
 * Supports both interactive OTP entry and read-only pairing PIN display. Respects prefers-reduced-motion. */

import { useLingui } from '@lingui/react/macro';
import { useReducedMotion } from 'motion/react';
import {
  useCallback, useEffect, useId, useRef, useState,
  type ChangeEvent, type ClipboardEvent, type KeyboardEvent, type MouseEvent,
} from 'react';
import { cn } from '#lib/cn';
import { DUR } from '#lib/motion';
import {
  CodeSlotCell, digitsOf, firstEmptyOf, isFull,
  SIZE_CONFIG, toSlots, type CodeSlotsSize, type CodeSlotsStatus,
} from './code-slot-cell';
import { CodeSlotsCaret, CodeSlotsSuccessWash, useCodeSlotsMotion } from './code-slots-motion';

export type { CodeSlotsSize, CodeSlotsStatus };

export interface CodeSlotsProps {
  length?: number;
  value?: string;
  defaultValue?: string;
  onChange?: (code: string) => void;
  onComplete?: (code: string) => void;
  status?: CodeSlotsStatus;
  readOnly?: boolean;
  placeholderChar?: string;
  size?: CodeSlotsSize;
  mask?: boolean;
  caret?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  rise?: number;
  cascade?: number;
  ariaLabel?: string;
  'aria-label'?: string;
  className?: string;
}

export function CodeSlots(props: CodeSlotsProps) {
  const {
    length = 6, value, defaultValue = '', onChange, onComplete, status = 'idle',
    readOnly = false, placeholderChar = '·', size = 'md', mask = false, caret = true,
    disabled = false, autoFocus = false, rise = 10,
    cascade = 28, ariaLabel, 'aria-label': ariaLabelAttr, className,
  } = props;
  const resolvedAriaLabel = ariaLabel ?? ariaLabelAttr;
  const { t } = useLingui();
  const uid = useId();
  const reduce = useReducedMotion();
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState(() => toSlots(value ?? defaultValue, length));
  const [active, setActive] = useState(() => firstEmptyOf(slots));
  const [focused, setFocused] = useState(false);
  const draining = useRef(false);
  const drainTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const statusRef = useRef(status);
  const emitted = useRef(digitsOf(value ?? defaultValue).slice(0, length));
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const live = useRef({ cascade, reduce });
  live.current = { cascade, reduce };
  const mountedRef = useRef(false);

  const cfg = SIZE_CONFIG[size];
  const pitch = cfg.slotW + cfg.gap;
  const {
    mvs, drops, target, veiled, caretTransform, washScaleX,
    checkY, checkScale, checkOpacity, drive, land, moveActive, jumpActive,
  } = useCodeSlotsMotion({
    length,
    pitch,
    active,
    setActive,
    status,
    cascade,
    reduce,
    slotsRef,
    statusRef,
  });

  const commit = useCallback(
    (next: string[]) => {
      const prev = slotsRef.current;
      slotsRef.current = next;
      setSlots(next);
      const code = next.join('');
      emitted.current = code;
      onChange?.(code);
      if (!isFull(prev) && isFull(next)) onComplete?.(code);
    },
    [onChange, onComplete],
  );

  const insert = (raw: string, from = active) => {
    const digits = digitsOf(raw);
    if (!digits) return;
    const next = [...slotsRef.current];
    const crossed: number[] = [];
    const step = reduce ? 0 : cascade;
    let i = from;
    for (const ch of digits) {
      if (i >= length) break;
      next[i] = ch;
      land(i, (i - from) * step);
      crossed.push(i);
      i += 1;
    }
    if (!crossed.length) return;
    commit(next);
    moveActive(Math.min(i, length - 1), crossed);
  };

  const clearSlot = (i: number, stepBack = false) => {
    if (!slotsRef.current[i]) return stepBack ? jumpActive(i) : undefined;
    const next = [...slotsRef.current];
    next[i] = '';
    drive(i, 0);
    commit(next);
    if (stepBack) moveActive(i, [i]);
  };

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    const initial = digitsOf(value ?? defaultValue).slice(0, length);
    if (initial && !reduce) initial.split('').forEach((_, idx) => land(idx, idx * cascade));
  }, [value, defaultValue, length, reduce, land, cascade]);

  useEffect(() => {
    if (value === undefined) return;
    const clean = digitsOf(value).slice(0, length);
    if (clean === emitted.current) return;
    emitted.current = clean;
    const prev = slotsRef.current;
    const next = toSlots(clean, length);
    const hidden = statusRef.current === 'success';
    const landing: number[] = [];
    const leaving: number[] = [];
    next.forEach((ch, i) => {
      if (ch !== prev[i]) (ch ? landing : leaving).push(i);
    });
    const step = live.current.reduce || hidden ? 0 : live.current.cascade;
    landing.forEach((i, k) => land(i, k * step));
    leaving.reverse().forEach((i, k) => {
      if (hidden) {
        target.current[i] = 0;
        mvs[i]?.jump(0);
        drops[i]?.jump(0);
      } else drive(i, 0, k * step);
    });
    slotsRef.current = next;
    setSlots(next);
    moveActive(firstEmptyOf(next), [...landing, ...leaving]);
    if (!isFull(prev) && isFull(next)) onComplete?.(clean);
  }, [value, length, land, drive, moveActive, onComplete, mvs, drops, target]);

  useEffect(() => {
    if (status !== 'error') return;
    const filled = slotsRef.current.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
    if (!filled.length) return;
    filled.reverse();
    draining.current = true;
    const L = live.current;
    const step = L.reduce ? 0 : L.cascade;
    filled.forEach((i, k) => drive(i, 0, k * step));
    moveActive(0, slotsRef.current.map((_, j) => j));
    clearTimeout(drainTimer.current);
    drainTimer.current = setTimeout(() => {
      draining.current = false;
      commit(Array.from({ length }, () => ''));
    }, L.reduce ? 250 : (filled.length - 1) * step + DUR.short * 1000);
  }, [status, length, drive, moveActive, commit]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  useEffect(() => () => clearTimeout(drainTimer.current), []);
  useEffect(() => {
    if (autoFocus && !readOnly) inputRef.current?.focus();
  }, [autoFocus, readOnly]);

  const busy = disabled || draining.current || status === 'success' || readOnly;
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (busy || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (/^[0-9]$/.test(k)) {
      e.preventDefault();
      insert(k);
    } else if (k === 'Backspace') {
      e.preventDefault();
      if (slots[active]) clearSlot(active);
      else if (active > 0) clearSlot(active - 1, true);
    } else if (k === 'Delete') {
      e.preventDefault();
      clearSlot(active);
    } else if (k === 'ArrowLeft') {
      e.preventDefault();
      jumpActive(Math.max(active - 1, 0));
    } else if (k === 'ArrowRight') {
      e.preventDefault();
      jumpActive(Math.min(active + 1, length - 1));
    } else if (k === 'Home') {
      e.preventDefault();
      jumpActive(0);
    } else if (k === 'End') {
      e.preventDefault();
      jumpActive(length - 1);
    }
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    if (!busy) {
      e.preventDefault();
      insert(e.clipboardData.getData('text'));
    }
  };
  const onInput = (e: ChangeEvent<HTMLInputElement>) => {
    const d = digitsOf(e.target.value);
    if (!busy && d) insert(d, d.length === 1 ? active : 0);
  };
  const onRowMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (disabled || readOnly) return;
    e.preventDefault();
    if (rowRef.current && !draining.current && status !== 'success') {
      const i = Math.floor((e.clientX - rowRef.current.getBoundingClientRect().left) / pitch);
      jumpActive(Math.max(0, Math.min(i, firstEmptyOf(slotsRef.current))));
    }
    inputRef.current?.focus();
  };

  const view = slots.length === length ? slots : Array.from({ length }, (_, i) => slots[i] ?? '');
  const hasDigits = view.some(Boolean);
  const showCaret =
    !readOnly && caret && focused && !disabled && !veiled && status !== 'success' && (status === 'error' || !view[active]);

  const cells = view.map((ch, i) => (
    <CodeSlotCell
      key={i}
      mv={mvs[i]!}
      drop={drops[i]!}
      char={mask && ch ? '•' : ch}
      placeholderChar={readOnly ? placeholderChar : ''}
      active={!readOnly && focused && i === active}
      readOnly={readOnly}
      size={size}
      rise={rise}
      sink={Math.round(cfg.slotH * 0.5)}
    />
  ));

  if (readOnly) {
    return (
      <p
        data-slot="pin"
        aria-label={resolvedAriaLabel}
        style={{ gap: `${cfg.gap}px` }}
        className={cn('m-0 inline-flex items-center', className)}
      >
        <span className="sr-only">{hasDigits ? t`PIN` : t`No PIN yet`}</span>
        {cells}
      </p>
    );
  }

  return (
    <div data-slot="code-slots" className={cn('relative inline-block', className)}>
      <div
        ref={rowRef}
        style={{ gap: `${cfg.gap}px` }}
        className="group/row relative inline-flex cursor-text touch-manipulation items-center data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
        data-status={status}
        data-focused={focused ? '' : undefined}
        data-disabled={disabled ? '' : undefined}
        onMouseDown={onRowMouseDown}
      >
        <input
          ref={inputRef}
          className="absolute inset-0 z-20 m-0 cursor-inherit appearance-none border-0 bg-transparent p-0 text-base text-transparent opacity-0 outline-0"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          value=""
          maxLength={length}
          aria-label={resolvedAriaLabel ?? t`PIN`}
          aria-invalid={status === 'error'}
          aria-describedby={`${uid}-count`}
          disabled={disabled}
          readOnly={status === 'success'}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onChange={onInput}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {cells}
        <CodeSlotsSuccessWash
          washScaleX={washScaleX}
          checkY={checkY}
          checkScale={checkScale}
          checkOpacity={checkOpacity}
        />
        <CodeSlotsCaret
          active={active}
          showCaret={showCaret}
          slotW={cfg.slotW}
          caretTransform={caretTransform}
        />
      </div>
      <span id={`${uid}-count`} className="sr-only" aria-live="polite">
        {hasDigits ? t`PIN` : t`No PIN yet`}
      </span>
    </div>
  );
}
