// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: kinds (UX3) · genre: atmospheric studio app · system: DESIGN.md v0.6 ("Kinds")
 * what a template or a slot is, as an icon in its kind's strong tone beside its word, or a soft chip with both:
 *   a format's family (story sky, voice orchid, show-how coral, reveal lime) and a slot's role (the hook coral, the
 *   peak orchid, the ending sky; the middle stays neutral). Colour is never the only sign: the word or the icon's
 *   name always goes with it
 * contrast: <kind>-strong on canvas, raised, sunken and its own soft ≥ 4.5:1 in both themes (contrast-report.md)
 */
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { FormatId, Template } from '@taalcut/core';
import {
  Clapperboard,
  Columns2,
  Film,
  Flag,
  ListChecks,
  Magnet,
  Mic,
  Mountain,
  ShoppingBag,
  Sunrise,
  Trophy,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '#lib/cn';
import { ROLE_LABELS } from './slot-words';

export type FormatFamily = 'story' | 'voice' | 'show' | 'reveal';
export type SlotRole = Template['slots'][number]['role'];

/** Each built-in format's family and icon: two formats to a family, so the family is the colour, the icon the format. */
export const FORMAT_KIND: Readonly<Record<FormatId, { family: FormatFamily; icon: LucideIcon }>> = {
  vlog: { family: 'story', icon: Clapperboard },
  dayInTheLife: { family: 'story', icon: Sunrise },
  talkingHead: { family: 'voice', icon: UserRound },
  podcastClip: { family: 'voice', icon: Mic },
  ugcAd: { family: 'show', icon: ShoppingBag },
  tutorial: { family: 'show', icon: ListChecks },
  beforeAfter: { family: 'reveal', icon: Columns2 },
  highlightReel: { family: 'reveal', icon: Trophy },
};

/** Each format's short name: the same words as the renderer's Format filter, so one catalogue entry each. */
export const FORMAT_LABELS: Readonly<Record<FormatId, MessageDescriptor>> = {
  vlog: msg`Vlog`,
  dayInTheLife: msg`Day in the life`,
  talkingHead: msg`Talking to camera`,
  podcastClip: msg`Podcast clip`,
  ugcAd: msg`Product ad`,
  beforeAfter: msg`Before and after`,
  tutorial: msg`How-to`,
  highlightReel: msg`Highlight reel`,
};

/** A tone's classes, written out whole so Tailwind finds them: the wash, the strong text or icon, a mark's fill. */
export interface KindTone {
  readonly soft: string;
  readonly strong: string;
  readonly mark: string;
}

export const FAMILY_TONE: Readonly<Record<FormatFamily, KindTone>> = {
  story: { soft: 'bg-format-story-soft', strong: 'text-format-story-strong', mark: 'bg-format-story-strong' },
  voice: { soft: 'bg-format-voice-soft', strong: 'text-format-voice-strong', mark: 'bg-format-voice-strong' },
  show: { soft: 'bg-format-show-soft', strong: 'text-format-show-strong', mark: 'bg-format-show-strong' },
  reveal: {
    soft: 'bg-format-reveal-soft',
    strong: 'text-format-reveal-strong',
    mark: 'bg-format-reveal-strong',
  },
};

const NEUTRAL: KindTone = { soft: 'bg-chip', strong: 'text-ink-2', mark: 'bg-ink-3' };

/** A slot's role: the hook, the peak and the ending have a colour; the middle slots stay neutral. */
export const ROLE_KIND: Readonly<Record<SlotRole, { tone: KindTone; icon: LucideIcon }>> = {
  hook: {
    tone: { soft: 'bg-slot-hook-soft', strong: 'text-slot-hook-strong', mark: 'bg-slot-hook-strong' },
    icon: Magnet,
  },
  body: { tone: NEUTRAL, icon: Film },
  peak: {
    tone: { soft: 'bg-slot-peak-soft', strong: 'text-slot-peak-strong', mark: 'bg-slot-peak-strong' },
    icon: Mountain,
  },
  outro: {
    tone: { soft: 'bg-slot-outro-soft', strong: 'text-slot-outro-strong', mark: 'bg-slot-outro-strong' },
    icon: Flag,
  },
};

const CHIP =
  'inline-flex w-fit shrink-0 items-center gap-1 rounded-pill px-2 py-0.5 text-xs font-semibold whitespace-nowrap [&_svg]:size-3 [&_svg]:shrink-0';

/** A format as a chip: its icon and its name on its family's wash. */
export function FormatChip({
  formatId,
  label,
  className,
  ...props
}: { formatId: FormatId; label?: string } & ComponentProps<'span'>) {
  const { i18n } = useLingui();
  const kind = FORMAT_KIND[formatId];
  const tone = FAMILY_TONE[kind.family];
  const Icon = kind.icon;
  return (
    <span
      data-slot="format-chip"
      data-family={kind.family}
      className={cn(CHIP, tone.soft, tone.strong, className)}
      {...props}
    >
      <Icon aria-hidden />
      {label ?? i18n._(FORMAT_LABELS[formatId])}
    </span>
  );
}

/** A format's icon in its family's strong tone; the caller says its name beside it. */
export function FormatIcon({ formatId, className }: { formatId: FormatId; className?: string }) {
  const kind = FORMAT_KIND[formatId];
  const Icon = kind.icon;
  return (
    <Icon aria-hidden data-family={kind.family} className={cn(FAMILY_TONE[kind.family].strong, className)} />
  );
}

/** A slot's role as a chip: its icon and its word ("Hook", "Peak") on its colour's wash; the middle on sunken. */
export function RoleChip({
  role,
  className,
  label,
}: {
  role: SlotRole;
  className?: string;
  /** The words to show instead of the role's own (a hub slot's "Hook"). */
  label?: MessageDescriptor;
}) {
  const { i18n } = useLingui();
  const { tone, icon: Icon } = ROLE_KIND[role];
  return (
    <span data-slot="role-chip" data-role={role} className={cn(CHIP, tone.soft, tone.strong, className)}>
      <Icon aria-hidden />
      {i18n._(label ?? ROLE_LABELS[role])}
    </span>
  );
}
