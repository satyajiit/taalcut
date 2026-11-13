// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: preset picker · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * where the video is going: a segmented control on a card, hairline rows with the length limit and the size in the
 *   export dialog; one radio group, arrows move and choose, Home and End
 * states: default · hover (hover surface / ink) · focus (base ring, instant, roving) · active (pressed) · checked
 *   (raised segment, or the filled radio dot in ink) · disabled (a preset this video can't use: its reason in words;
 *   or the whole group while an answer is in flight) · loading/error/success: the caller's line (a preset change is
 *   a command; its failure puts the choice back)
 * pre-emit critique: P5 H4 E5 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import type { ExportPresetId } from '@taalcut/core';
import { useRef, type KeyboardEvent } from 'react';
import { cn } from '#lib/cn';
import { ProviderLogo } from '../components/provider-logo';
import { backendText, presetLabel } from './render-words';

export interface PresetOption {
  readonly id: ExportPresetId;
  readonly available: boolean;
  /** Why not, e.g. 'render.unavailable.tooLong'. */
  readonly reasonKey?: string | undefined;
  readonly maxSeconds?: number | undefined;
  readonly estimateBytes?: number | undefined;
}

export interface PresetPickerProps {
  options: readonly PresetOption[];
  value: ExportPresetId;
  onChange: (id: ExportPresetId) => void;
  variant?: 'segmented' | 'list';
  disabled?: boolean;
  /** Names the group; default "Where it’s going". */
  label?: string;
  className?: string;
}

const NOT_AVAILABLE = msg`Not for this video`;

export function PresetPicker({
  options,
  value,
  onChange,
  variant = 'segmented',
  disabled = false,
  label,
  className,
}: PresetPickerProps) {
  const { t, i18n } = useLingui();
  const group = useRef<HTMLDivElement>(null);
  const usable = options.filter((option) => option.available);
  const locale = i18n.locale === 'en-XA' ? 'en' : i18n.locale;
  // A limit a second short of a whole minute (179 s) reads as that minute: "Up to 3 min", never "2.983 min".
  const minutes = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'minute',
    unitDisplay: 'short',
    maximumFractionDigits: 1,
  });
  const seconds = new Intl.NumberFormat(locale, { style: 'unit', unit: 'second', unitDisplay: 'short' });
  const megabytes = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'megabyte',
    unitDisplay: 'short',
    maximumFractionDigits: 0,
  });

  const choose = (id: ExportPresetId) => {
    onChange(id);
    group.current?.querySelector<HTMLElement>(`[data-preset="${id}"]`)?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || usable.length === 0) return;
    const at = Math.max(
      0,
      usable.findIndex((option) => option.id === value),
    );
    const moves: Record<string, number> = {
      ArrowRight: (at + 1) % usable.length,
      ArrowDown: (at + 1) % usable.length,
      ArrowLeft: (at - 1 + usable.length) % usable.length,
      ArrowUp: (at - 1 + usable.length) % usable.length,
      Home: 0,
      End: usable.length - 1,
    };
    if (event.key in moves) {
      event.preventDefault();
      choose(usable[moves[event.key]!]!.id);
    }
  };

  const limit = (option: PresetOption) => {
    if (!option.maxSeconds) return null;
    const max =
      option.maxSeconds >= 120
        ? minutes.format(Math.round(option.maxSeconds / 6) / 10)
        : seconds.format(option.maxSeconds);
    return t`Up to ${max}`;
  };

  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={label ?? t`Where it’s going`}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      data-slot="preset-picker"
      data-variant={variant}
      className={cn(
        variant === 'segmented'
          ? 'inline-flex w-fit max-w-full flex-wrap items-center gap-0.5 rounded-pill border border-rule bg-sunken p-0.5'
          : 'flex flex-col',
        className,
      )}
    >
      {options.map((option) => {
        const checked = option.id === value;
        const off = disabled || !option.available;
        const name = presetLabel(i18n, option.id);
        const reason = option.available
          ? null
          : option.reasonKey
            ? backendText(i18n, option.reasonKey, NOT_AVAILABLE)
            : i18n._(NOT_AVAILABLE);
        const common = {
          role: 'radio' as const,
          'aria-checked': checked,
          'aria-disabled': off || undefined,
          'data-preset': option.id,
          tabIndex: checked && !disabled ? 0 : -1,
          onClick: () => {
            if (!off) choose(option.id);
          },
        };
        if (variant === 'segmented') {
          return (
            <button
              key={option.id}
              type="button"
              {...common}
              title={reason ?? undefined}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-sm font-medium whitespace-nowrap',
                'transition-colors duration-(--dur-micro) ease-(--ease-out)',
                checked ? 'bg-raised text-ink shadow-sm' : 'text-ink-2',
                off
                  ? 'cursor-not-allowed text-ink-disabled'
                  : 'cursor-pointer hover:text-ink active:bg-pressed',
              )}
            >
              <ProviderLogo provider={option.id} size="xs" framed={false} aria-hidden />
              {name}
            </button>
          );
        }
        const meta = [
          limit(option),
          option.estimateBytes ? megabytes.format(option.estimateBytes / 1_000_000) : null,
        ].filter(Boolean);
        return (
          <button
            key={option.id}
            type="button"
            {...common}
            className={cn(
              'flex w-full items-start gap-3 border-b border-rule-subtle px-1 py-2 text-start last:border-b-0',
              'transition-colors duration-(--dur-micro) ease-(--ease-out)',
              off ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-hover active:bg-pressed',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'mt-0.5 grid size-4 shrink-0 place-items-center rounded-pill border',
                off ? 'border-rule-subtle' : checked ? 'border-ink' : 'border-rule-strong',
              )}
            >
              {checked ? <span className="block size-2 rounded-pill bg-ink" /> : null}
            </span>
            <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 text-sm font-medium',
                  off ? 'text-ink-disabled' : 'text-ink',
                )}
              >
                <ProviderLogo provider={option.id} size="xs" framed={false} aria-hidden />
                {name}
              </span>
              {reason ? (
                <span className="text-xs text-ink-3">{reason}</span>
              ) : meta.length > 0 ? (
                <span className="text-xs text-ink-2 tabular-nums">{meta.join(' · ')}</span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
