// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: story avatar · mode: Persuade · system: WEB2 Remix Vernacular
 * states: lit (the ring in its way's colour: violet for a cloud AI, the AI's; teal for Taalcut's own models, yours;
 *   ink for your own server) · paused (Local only on: a dashed rule ring, the icon greyed) · glowing (Local only on,
 *   on Taalcut's own models: the teal ring lifts on its shadow) · sizes xs to lg. A drawing, never a control: the
 *   tray's button carries the states (hover, focus, pressed). motion: none of its own (the ring and grey cross-fade
 *   on the tokens' short duration, none under reduced motion).
 * A provider's round avatar as a story tray draws one: its ring, a raised disc, and the provider's real SVGL icon in
 * its own colours. A brand SVGL lacks (ElevenLabs, LM Studio) shows its category's glyph from the app's registry (voice,
 * server), never a stand-in mark; Taalcut's own models show the Avartan. Hidden from assistive technology: the name in
 * words beside it says who it is. */

import { Mic, Server, type LucideIcon } from 'lucide-react';
import { BrandIcon, isBrandIconId } from '#components/brand/brand-icon';
import { Logo } from '#components/brand/logo';
import type { StoryRing } from '#content/ai-stories';
import type { Provider } from '#content/schema';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';

/** The app's glyph for a brand SVGL has no icon for (packages/ui icons/concepts.ts: voice, server). */
export const PROVIDER_GLYPHS: Readonly<Record<string, LucideIcon>> = { elevenlabs: Mic, 'lm-studio': Server };

/** The ring's colour, by the way in. Graphics take the jobs' strong steps, so each ring holds 3:1 on both grounds. */
export const RING_CLASSES: Readonly<Record<StoryRing, string>> = {
  ai: 'border-violet-strong',
  you: 'border-teal-strong',
  server: 'border-ink',
};

const SIZES = {
  xs: { box: 'size-8 border-2 p-[2px]', icon: 'size-4.5' },
  sm: { box: 'size-12 border-[2.5px] p-[3px]', icon: 'size-6' },
  md: { box: 'size-16 border-[2.5px] p-[3px]', icon: 'size-8' },
  lg: { box: 'size-[4.5rem] border-[3px] p-[3px]', icon: 'size-8' },
} as const;

export type StoryAvatarSize = keyof typeof SIZES;

export interface StoryAvatarProps {
  readonly provider: Provider;
  readonly ring: StoryRing;
  readonly size?: StoryAvatarSize;
  readonly paused?: boolean;
  readonly glowing?: boolean;
  readonly className?: string;
}

function Mark({ provider, className }: { readonly provider: Provider; readonly className: string }) {
  if (isBrandIconId(provider.markId)) return <BrandIcon id={provider.markId} className={className} />;
  if (provider.way === 'on-device') return <Logo kind="symbol" colourway="four-colour" className={className} />;
  const Glyph = PROVIDER_GLYPHS[provider.id] ?? Server;
  return <Glyph data-slot="provider-glyph" strokeWidth={ICON_STROKE} className={cn('text-ink', className)} />;
}

export function StoryAvatar({ provider, ring, size = 'md', paused = false, glowing = false, className }: StoryAvatarProps) {
  const s = SIZES[size];
  return (
    <span
      aria-hidden
      data-slot="story-avatar"
      data-ring={paused ? 'paused' : ring}
      className={cn(
        'inline-flex shrink-0 rounded-full transition-[border-color,box-shadow] duration-(--dur-short) ease-(--ease-out) motion-reduce:transition-none',
        s.box,
        paused ? 'border-dashed border-rule-strong' : RING_CLASSES[ring],
        glowing && !paused && 'shadow-lift',
        className,
      )}
    >
      <span
        className={cn(
          'grid size-full place-items-center rounded-full bg-raised ring-1 ring-rule-subtle transition-[filter,opacity] duration-(--dur-short) motion-reduce:transition-none',
          paused && 'opacity-55 grayscale',
        )}
      >
        <Mark provider={provider} className={s.icon} />
      </span>
    </span>
  );
}
