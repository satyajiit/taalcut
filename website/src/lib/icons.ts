// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import {
  ArrowRight,
  AudioLines,
  Captions,
  ChartPie,
  Check,
  Clapperboard,
  Code,
  Compass,
  Cpu,
  FileDown,
  FileText,
  Film,
  FlaskConical,
  Folder,
  Gift,
  Heart,
  Info,
  KeyRound,
  Laptop,
  ListChecks,
  LogIn,
  Mail,
  Menu,
  MessageCircleQuestion,
  MessageSquare,
  Moon,
  Newspaper,
  Palette,
  Pause,
  PawPrint,
  Play,
  PlugZap,
  Quote,
  RectangleVertical,
  Scissors,
  Search,
  Server,
  Shapes,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  SquarePlay,
  Sticker,
  Sun,
  Type,
  Undo2,
  Upload,
  Wifi,
  X,
  type LucideIcon,
} from 'lucide-react';

/**
 * One Lucide glyph per thing and per action, the same choices as the app's registry
 * (packages/ui/src/icons/concepts.ts), so a clip or a beat looks the same on the site as in Taalcut. Pick from here,
 * never by taste. The AI is the Avartan's beat-three mark (components/brand/ai-mark), never a sparkle.
 */
export const ICONS = {
  clip: Film,
  reel: SquarePlay,
  template: Shapes,
  slot: RectangleVertical,
  beat: AudioLines,
  breakdown: ChartPie,
  trim: Scissors,
  caption: Captions,
  graphic: Sticker,
  make: Clapperboard,
  export: Upload,
  chat: MessageSquare,
  checks: ListChecks,
  phone: Smartphone,
  wifi: Wifi,
  folder: Folder,
  search: Search,
  model: Cpu,
  account: KeyRound,
  server: Server,
  privacy: ShieldCheck,
  thisComputer: Laptop,
  signIn: LogIn,
  undo: Undo2,
  approve: Check,
  mail: Mail,
  play: Play,
  pause: Pause,
  menu: Menu,
  close: X,
  next: ArrowRight,
  light: Sun,
  dark: Moon,
  // The content pages' sections and heads (a server page names its icon; Section and PageHead look it up).
  plug: PlugZap,
  sliders: SlidersHorizontal,
  question: MessageCircleQuestion,
  info: Info,
  type: Type,
  heart: Heart,
  compass: Compass,
  code: Code,
  press: Newspaper,
  quote: Quote,
  paw: PawPrint,
  palette: Palette,
  files: FileDown,
  terms: FileText,
  expect: FlaskConical,
  gift: Gift,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

/** A glyph by name from ICONS, or a Lucide icon as it is: what a server page can hand a client component is a name. */
export type IconRef = LucideIcon | IconName;

export function iconOf(icon: IconRef): LucideIcon {
  return typeof icon === 'string' ? ICONS[icon] : icon;
}

/** DESIGN.md › Icons: 14 on small controls and chips, 16 in controls and rows, 20 beside a heading. Stroke 2. */
export const ICON_SIZE = { sm: 14, md: 16, lg: 20 } as const;
export const ICON_STROKE = 2;
