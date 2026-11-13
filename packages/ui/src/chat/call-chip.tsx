// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: call-chip · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.2 · states: idle · running · done · error, and on error with a retry:
 * hover · focus (ring on the chip) · active (pressed) · disabled n/a · loading = running · success = done */

import { Trans, useLingui } from '@lingui/react/macro';
import Upstream, { type CallChipIcon, type CallChipStatus } from '@taalcut-vendor/react-bits/call-chip';
import type { ReactNode } from 'react';
import { useFormatters } from '#lib/format';
import { UserContent } from '../cards/card-frame';

export type ToolCallStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

const STATUS: Record<ToolCallStatus, CallChipStatus> = {
  running: 'running',
  succeeded: 'done',
  failed: 'error',
  cancelled: 'idle',
};

/** Maps a tool identifier to an appropriate CallChip icon glyph. */
export function toolIconFor(tool?: string): CallChipIcon {
  if (!tool) return 'terminal';
  const lower = tool.toLowerCase();
  if (lower.includes('.search') || lower.includes('.find') || lower.includes('.list')) {
    return 'search';
  }
  if (lower.startsWith('design.') || lower.startsWith('graphics.') || lower.startsWith('workspace.')) {
    return 'sparkles';
  }
  if (lower.startsWith('timeline.') || lower.startsWith('render.') || lower.startsWith('video.')) {
    return 'film';
  }
  if (
    lower.startsWith('audio.') ||
    lower.startsWith('music.') ||
    lower.startsWith('sfx.') ||
    lower.startsWith('voice.') ||
    lower.startsWith('captions.')
  ) {
    return 'audio';
  }
  if (
    lower.startsWith('templates.') ||
    lower.startsWith('vision.') ||
    lower.startsWith('images.') ||
    lower.startsWith('soul.') ||
    lower.startsWith('sandbox.')
  ) {
    return 'wand';
  }
  return 'terminal';
}

/**
 * Replaces raw HyperFrames workspace paths like `vietnam-chat/index.html` with a
 * human-friendly motion graphic label (`vietnam-chat · Motion graphic`).
 */
export function formatMotionGraphicSummary(text: string, badgeLabel?: string): string {
  if (!text) return text;
  const suffix = badgeLabel ? ` · ${badgeLabel}` : '';
  return text.replace(/(?:^|(?<=\s))([A-Za-z0-9_.-]+)\/index\.html\b/g, `$1${suffix}`);
}

export interface CallChipProps {
  /** What the tool does, in plain words ("Look at a frame"). */
  name: string;
  /** Optional tool id used to pick a domain icon when `icon` is not explicitly provided. */
  tool?: string;
  /** What it works on, as written (a file name), if known. */
  argument?: string;
  status: ToolCallStatus;
  icon?: CallChipIcon | ReactNode;
  /** How long a call like this usually takes; the fill holds at 90% until it ends. */
  expectedMs?: number;
  onRetry?: () => void;
  /**
   * Says nothing itself: the caller announces how it went (a group of calls, whose chip sits in its disclosure
   * button and whose status is said once, in its own words).
   */
  quiet?: boolean;
  /**
   * When the work began (epoch ms), for a group of calls: its timer counts from the first call, across the pauses
   * between them. A single call leaves it out and counts from when it started running.
   */
  startedAt?: number;
  className?: string;
}

/** What a screen reader hears for a call: the tool, what it works on (as written) and how it went. */
function Spoken({
  label,
  target,
  status,
  took,
}: {
  label: string;
  target: string;
  status: CallChipStatus;
  took: string;
}) {
  const what = target ? (
    <Trans>
      {label}, <UserContent>{target}</UserContent>
    </Trans>
  ) : (
    label
  );
  if (status === 'running') return <Trans>{what}: running</Trans>;
  if (status === 'done')
    return took ? (
      <Trans>
        {what}: done in {took}
      </Trans>
    ) : (
      <Trans>{what}: done</Trans>
    );
  if (status === 'error') return <Trans>{what}: failed</Trans>;
  return <Trans>{what}: stopped</Trans>;
}

/**
 * React Bits' CallChip (third_party/react-bits) for one tool call in a run:
 * its name, what it works on and a live timer, filling violet while it runs
 * (agent work, DESIGN.md v0.2, A12). No shake, no glow.
 */
export function CallChip({
  name,
  tool,
  argument,
  status,
  icon,
  expectedMs,
  onRetry,
  quiet = false,
  startedAt,
  className,
}: CallChipProps) {
  const { t, i18n } = useLingui();
  const format = useFormatters();
  const cleanedArgument = argument ? formatMotionGraphicSummary(argument, t`Motion graphic`) : '';
  return (
    <Upstream
      // Upstream keeps what it last said (the name in its status line) from the status change: a language
      // switch (P3-L2) starts it again, so that line is said in the new language too.
      key={i18n.locale}
      name={name}
      argument={cleanedArgument}
      status={STATUS[status]}
      icon={icon ?? toolIconFor(tool)}
      expectedMs={expectedMs ?? 3000}
      size={26}
      color="var(--color-ink-2)"
      progressColor="var(--color-ai-strong)"
      progressOpacity={0.12}
      formatElapsed={format.duration}
      {...(startedAt === undefined ? {} : { startedAt })}
      labels={{
        describe: quiet
          ? () => ''
          : (label, target, chipStatus, ms) => (
              <Spoken
                label={label}
                target={target}
                status={chipStatus}
                took={ms === null ? '' : format.duration(ms)}
              />
            ),
        retry: (label) => t`Try “${label}” again`,
      }}
      {...(onRetry ? { onRetry } : {})}
      className={className}
    />
  );
}
