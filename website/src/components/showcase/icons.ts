// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import {
  Blend,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleDashed,
  Clapperboard,
  Columns2,
  Flag,
  Gauge,
  Layers,
  ListChecks,
  LoaderCircle,
  Magnet,
  Mic,
  Mountain,
  MoveHorizontal,
  Music,
  Redo2,
  RefreshCw,
  RotateCcw,
  ShoppingBag,
  SlidersHorizontal,
  Sunrise,
  Timer,
  Trophy,
  Type,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { ICONS } from '#lib/icons';

/**
 * The showcases' glyphs: the site registry (#lib/icons) first, then the few it lacks, each the same choice the app
 * makes (packages/ui/src/templates/review-icons.ts, kinds.tsx, status-mark). They are named here once, for the
 * registry to take in (WEB1-SHOW hand-off, foundation requests); a showcase never picks a glyph at the call site.
 */
export const SHOWCASE_ICONS = {
  ...ICONS,
  toCheck: CircleDashed,
  passed: CircleCheck,
  pending: Circle,
  running: LoaderCircle,
  slots: Layers,
  length: Timer,
  music: Music,
  text: Type,
  speed: Gauge,
  whip: MoveHorizontal,
  dissolve: Blend,
  replay: RotateCcw,
  earlier: ChevronLeft,
  later: ChevronRight,
  redo: Redo2,
  newCode: RefreshCw,
  values: SlidersHorizontal,
} as const satisfies Record<string, LucideIcon>;

/** A starter's format: its family colours the chip, its icon names the format (kinds.tsx, FORMAT_KIND). */
export const FORMAT_ICONS = {
  vlog: Clapperboard,
  dayInTheLife: Sunrise,
  talkingHead: UserRound,
  podcastClip: Mic,
  ugcAd: ShoppingBag,
  tutorial: ListChecks,
  beforeAfter: Columns2,
  highlightReel: Trophy,
} as const satisfies Record<string, LucideIcon>;

/** A slot's role (kinds.tsx, ROLE_KIND): the hook, the peak and the ending have a kind hue; the middle is neutral. */
export const ROLE_ICONS = {
  hook: Magnet,
  build: ICONS.clip,
  peak: Mountain,
  outro: Flag,
} as const satisfies Record<string, LucideIcon>;
