// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One Lucide glyph per thing and per action (UX4, research C8 and C9): a clip looks the same in the sidebar, a
 * section heading, a row and an empty state, and "Try again" carries the same arrow on every page. Pick an icon
 * from here, never by taste at the call site; a new concept or verb is added here first.
 *
 * Sizes are fixed at 14, 16 and 20 px with one stroke (ICON_SIZE, ICON_STROKE): 14 in chips and dense meta, 16 in
 * controls and rows, 20 beside a section heading or in a choice tile.
 */
import {
  Activity,
  Archive,
  ArchiveRestore,
  ArrowDownToLine,
  ArrowDownWideNarrow,
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  ArrowUp,
  ArrowUpRight,
  AudioLines,
  AudioWaveform,
  Ban,
  Blend,
  Blocks,
  Bookmark,
  BookOpen,
  Bot,
  Brain,
  BrushCleaning,
  Cable,
  Calendar,
  Captions,
  ChartPie,
  Check,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDot,
  CircleFadingArrowUp,
  CircleHelp,
  CircleMinus,
  CircleStop,
  Clapperboard,
  Clock,
  Cloud,
  CloudUpload,
  Copy,
  Cpu,
  CreditCard,
  DatabaseBackup,
  Download,
  Ellipsis,
  ExternalLink,
  Eye,
  FileCode,
  FileText,
  Film,
  Folder,
  FolderCode,
  FolderInput,
  FolderOpen,
  FolderPlus,
  FolderX,
  FoldHorizontal,
  FunnelX,
  Gauge,
  Globe,
  Gpu,
  HandHeart,
  History,
  Hourglass,
  Image,
  Import,
  Info,
  KeyRound,
  Languages,
  Laptop,
  Layers,
  LayoutGrid,
  LayoutTemplate,
  Link2,
  ListChecks,
  ListFilter,
  ListRestart,
  ListTree,
  LoaderCircle,
  Luggage,
  LogIn,
  LogOut,
  MapPin,
  MessageCircle,
  MessageCirclePlus,
  MessageSquare,
  MessageSquarePlus,
  MessageSquareText,
  Mic,
  Move,
  Music,
  PackageOpen,
  Palette,
  PanelsTopLeft,
  Pause,
  Pencil,
  PencilLine,
  Play,
  PlugZap,
  Plus,
  Puzzle,
  RectangleVertical,
  Redo2,
  RefreshCw,
  Replace,
  RotateCcw,
  ScanLine,
  ScanSearch,
  Scissors,
  ScrollText,
  Search,
  Server,
  Settings,
  Shapes,
  Share,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  SquareCheckBig,
  SquarePlay,
  Star,
  Sticker,
  SunMoon,
  SwatchBook,
  Trash2,
  TriangleAlert,
  Type,
  Undo2,
  UnfoldHorizontal,
  Unlink,
  Upload,
  Volume2,
  Wallet,
  Wifi,
  WifiOff,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';

/** The three icon sizes, in px: chips and dense meta, controls and rows, section headings and tiles. */
export const ICON_SIZE = { sm: 14, md: 16, lg: 20 } as const;
export type IconSize = keyof typeof ICON_SIZE;

/** The one stroke width, Lucide's own (2 on its 24 px grid). Never thicken a glyph to make it read: size it up. */
export const ICON_STROKE = 2;

/** Things: what a page, a section, a row or a view is about. The areas use the sidebar's own glyphs. */
export const CONCEPT_ICONS = {
  // Areas (shell/areas.ts): an area is named by what it holds. Agent is the kit's AI mark, not a Lucide glyph.
  make: Clapperboard,
  library: Film,
  templates: AudioWaveform,
  // What the areas hold.
  project: Clapperboard,
  clip: Film,
  template: Shapes,
  slot: RectangleVertical,
  beat: AudioLines,
  // How often the cuts come: a template's Pacing page and the editor's pacing track.
  pacing: Activity,
  // Words on screen: the editor's text track, a template's text slots.
  text: Type,
  reel: SquarePlay,
  export: Upload,
  archived: Archive,
  hub: Globe,
  saved: Bookmark,
  chat: MessageSquare,
  // EDT1-CMT: a comment on the edit, round where the chat's mark is square.
  comment: MessageCircle,
  version: History,
  // A copy put back: the library file restored from its backup.
  backup: DatabaseBackup,
  effect: Layers,
  image: Image,
  music: Music,
  caption: Captions,
  voice: Mic,
  // EDT1: what the editor's bed holds besides clips and words: a motion graphic, a transition between two clips.
  graphic: Sticker,
  transition: ArrowRightLeft,
  // HFW1-UI: a designed graphic's files (the editor's Files tab), one of them, and the checks it passed.
  designFiles: FolderCode,
  file: FileCode,
  checks: ListChecks,
  // What your videos have in common (Make › Your style).
  styleProfile: Blend,
  // Templates' places: Start from… and what it holds, a template's overview, Your templates' and Saved's places.
  startFrom: LayoutGrid,
  starter: PackageOpen,
  format: LayoutTemplate,
  overview: PanelsTopLeft,
  // Everything in a place: All templates, All Saved. Layers, like an effect; the two never share a screen.
  all: Layers,
  favourite: Star,
  unfiled: FolderX,
  // A collection Taalcut keeps an eye on (Saved on Instagram).
  watched: Eye,
  // Where footage comes from.
  phone: Smartphone,
  folder: Folder,
  source: FolderInput,
  wifi: Wifi,
  cable: Cable,
  transfer: ArrowDownToLine,
  // Settings.
  model: Cpu,
  account: KeyRound,
  plugin: Puzzle,
  externalAgent: Bot,
  brandKit: Palette,
  privacy: ShieldCheck,
  memory: Brain,
  usage: Gauge,
  about: Info,
  thisComputer: Laptop,
  gpu: Gpu,
  language: Languages,
  appearance: SunMoon,
  sound: Volume2,
  help: CircleHelp,
  // Settings' own pages and views: General and what it holds, Usage's, Accounts', a plugin's, a brand kit's, Models'
  // and Privacy's. A brand kit's Type is `text` and its logo `image`; a plugin's access is `privacy`.
  general: SlidersHorizontal,
  update: CircleFadingArrowUp,
  parts: Blocks,
  licence: FileText,
  feedback: MessageSquareText,
  breakdown: ChartPie,
  budget: Wallet,
  request: ScrollText,
  connected: PlugZap,
  subscription: CreditCard,
  server: Server,
  // A plugin's connection: where it is reached. The same chain as Copy link, which hands out where a thing is.
  connection: Link2,
  tool: Wrench,
  skill: BookOpen,
  colour: SwatchBook,
  job: ListTree,
  sharing: HandHeart,
  upload: CloudUpload,
  cloud: Cloud,
  // Facts.
  duration: Clock,
  date: Calendar,
  /** LIB1-PLACE: where a clip was shot, and a trip it is part of. */
  place: MapPin,
  trip: Luggage,
  search: Search,
  filter: ListFilter,
  sort: ArrowDownWideNarrow,
  // Status: always with its word beside it (colour is never the only signal).
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleAlert,
  info: Info,
  running: LoaderCircle,
  waiting: Hourglass,
  offline: WifiOff,
  // A step of work still to come (LIB1-PROG, a clip's analysis): queued and about to start, later, or not needed.
  queued: CircleDot,
  pending: Circle,
  skipped: CircleMinus,
} as const satisfies Record<string, LucideIcon>;

export type Concept = keyof typeof CONCEPT_ICONS;

/** Actions: the verb a button, a menu item or a link does. */
export const VERB_ICONS = {
  makeVideo: Clapperboard,
  export: Upload,
  import: Import,
  addFolder: FolderPlus,
  clearFilters: FunnelX,
  signIn: LogIn,
  signOut: LogOut,
  findSimilar: ScanSearch,
  readReel: ScanLine,
  retry: RotateCcw,
  checkAgain: RefreshCw,
  undo: Undo2,
  redo: Redo2,
  delete: Trash2,
  rename: PencilLine,
  edit: Pencil,
  copy: Copy,
  copyLink: Link2,
  open: ArrowUpRight,
  openOutside: ExternalLink,
  reveal: FolderOpen,
  share: Share,
  download: Download,
  play: Play,
  pause: Pause,
  stop: CircleStop,
  add: Plus,
  newChat: MessageSquarePlus,
  select: SquareCheckBig,
  approve: Check,
  send: ArrowUp,
  settings: Settings,
  more: Ellipsis,
  back: ArrowLeft,
  // The way on in a flow (Next, Continue, Get started): back's mirror, after the words (iconPlacement="end").
  next: ArrowRight,
  close: X,
  swap: Replace,
  trim: Scissors,
  // A clip a beat shorter or longer: its end folds in or out.
  shorter: FoldHorizontal,
  longer: UnfoldHorizontal,
  cleanUp: BrushCleaning,
  // Put the selection in the chat's ask; the same glyph as a new chat, since both start the agent on something.
  addToChat: MessageSquarePlus,
  // EDT1-CMT: leave a comment on what is selected or under the playhead.
  comment: MessageCirclePlus,
  archive: Archive,
  unarchive: ArchiveRestore,
  forget: Unlink,
  revoke: Ban,
  // HFW1-UI: open a designed graphic's files; make an earlier version of them the current one.
  viewFiles: FolderCode,
  restore: ListRestart,
  // A designed graphic places and sizes itself: moving or resizing it on screen is asked of the AI.
  moveOnScreen: Move,
} as const satisfies Record<string, LucideIcon>;

export type Verb = keyof typeof VERB_ICONS;

/**
 * Actions that carry their icon wherever they show, by their English label (lower case, no ellipsis). The labels
 * the audit found iconed in one place and not another (P2-14) lead the list; test/icon-verbs.test.ts holds the app
 * to it.
 */
export const MUST_CARRY: Readonly<Record<string, Verb>> = {
  'make a video': 'makeVideo',
  export: 'export',
  'export again': 'export',
  'export all': 'export',
  import: 'import',
  'add folder': 'addFolder',
  'clear filters': 'clearFilters',
  'sign in': 'signIn',
  'sign out': 'signOut',
  'find similar': 'findSimilar',
  'read this reel': 'readReel',
  'try again': 'retry',
  'check again': 'checkAgain',
  undo: 'undo',
  open: 'open',
  'new chat': 'newChat',
  'start a chat': 'newChat',
  pause: 'pause',
  stop: 'stop',
};

/**
 * One name per action (WCAG 3.2.4): the name on the left is retired in favour of the one on the right. Page lanes
 * rename as they adopt the kit.
 */
export const ACTION_NAMES: Readonly<Record<string, keyof typeof MUST_CARRY>> = {
  // eslint-disable-next-line lingui/no-unlocalized-strings -- an English source label used as a key, not shown
  'add a folder': 'add folder',
};
