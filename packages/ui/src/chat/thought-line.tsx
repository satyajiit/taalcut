// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · component: thought-line · mode: Operate · system: DESIGN.md
 * States: working (quiet breathing dot and label) · settled · hidden/reduced motion (still).
 * Uses the vendored React Bits transition, with solid text and no blur. */

import { useLingui } from '@lingui/react/macro';
import Upstream, { type ThoughtLineProps as UpstreamProps } from '@taalcut-vendor/react-bits/thought-line';
import { useReducedMotion } from 'motion/react';
import { useSyncExternalStore } from 'react';
import { useFormatters } from '#lib/format';

export type ThoughtLineProps = Omit<UpstreamProps, 'formatElapsed' | 'speakElapsed' | 'fontSize' | 'shimmer'>;

function subscribeVisibility(changed: () => void) {
  document.addEventListener('visibilitychange', changed);
  return () => document.removeEventListener('visibilitychange', changed);
}

function documentVisible() {
  return document.visibilityState !== 'hidden';
}

/**
 * React Bits' ThoughtLine (third_party/react-bits) in Taalcut's type and
 * colours: a solid label and dot that breathe while it works, with an optional
 * translated timer. Pausing motion never changes the underlying run state.
 */
export function ThoughtLine({ label, doneLabel, glyph, glyphColor, color, ...props }: ThoughtLineProps) {
  const { t, i18n } = useLingui();
  const format = useFormatters();
  const reduce = useReducedMotion();
  const visible = useSyncExternalStore(subscribeVisibility, documentVisible, () => true);
  const running = props.working ?? true;
  return (
    <Upstream
      {...props}
      // Upstream writes its timer and its status line once, when the thinking settles: a language switch
      // (P3-L2) starts it again, so both are said in the new language too.
      key={i18n.locale}
      label={label ?? t`Thinking…`}
      doneLabel={doneLabel ?? t`Thought for`}
      fontSize="var(--text-sm)"
      shimmer={false}
      settleBlur={0}
      color={color ?? 'var(--color-ink-2)'}
      glyph={glyph ?? (running ? 'dot' : 'none')}
      glyphColor={glyphColor ?? 'var(--color-ai-strong)'}
      breathDepth={reduce || !visible ? 0 : (props.breathDepth ?? 0.18)}
      formatElapsed={(seconds) => format.duration(seconds * 1000)}
      speakElapsed={(seconds) => format.duration(seconds * 1000)}
    />
  );
}
