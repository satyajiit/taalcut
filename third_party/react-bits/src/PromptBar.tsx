/*
 * PromptBar, from React Bits (https://github.com/DavidHDev/react-bits)
 * at commit e2eb04d89d5be5a633dba7b2d4adfd274e053767,
 * src/ts-tailwind/Micro/PromptBar/PromptBar.tsx.
 * Copyright (c) 2026 David Haz. MIT + Commons Clause: see ../LICENSE.md.
 * Changed for Taalcut (styling, CSP, icons, i18n hooks): see the "upstream"
 * field in ../package.json; the original is in ../upstream/.
 */
'use client';

import React, {
  createElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode
} from 'react';
import { animate, useMotionValue, useMotionValueEvent, useReducedMotion } from 'motion/react';
import {
  Calendar,
  ChartLine,
  Check,
  ChevronDown,
  File,
  Globe,
  Mail,
  Mic,
  Paperclip,
  Plus,
  X,
  type LucideIcon
} from 'lucide-react';
export interface PromptBarSource {
  key: string;
  name: string;
  description?: string;
  icon?: ReactNode | LucideIcon;
  attach?: boolean;
}

export interface PromptBarCommand {
  key: string;
  name: string;
  description?: string;
}

export interface PromptBarModel {
  key: string;
  name: string;
  tag?: string;
  /** The heading the row sits under in the menu (e.g. its provider). Rows of one group come together. */
  group?: string;
  /** Shown after the name on the button, quieter (e.g. its provider). */
  detail?: string;
  /** Optional provider or model glyph shown in the menu row. */
  icon?: ReactNode | LucideIcon;
}

/** One effort level. A plain string is a level with that key and name. */
export interface PromptBarEffort {
  key: string;
  name: string;
  /** One line on what the level does, under the slider. */
  description?: string;
  /** The chosen model has no such level: drawn hollow, and keys and the pointer pass it by. */
  disabled?: boolean;
}

/** A last row in the model menu that does something instead of choosing (e.g. "Connect more…"). */
export interface PromptBarModelAction {
  label: string;
  onSelect: () => void;
}

export interface PromptBarSendDetail {
  attachments: string[];
  model?: PromptBarModel;
  effort?: string;
}

/** Every string the bar shows or announces, so the app can translate them. */
export interface PromptBarLabels {
  sources: string;
  commands: string;
  models: string;
  effort: string;
  effortHint: string;
  faster: string;
  smarter: string;
  noMatches: (query: string) => string;
  remove: (file: string) => string;
  listening: string;
  prompt: string;
  addSources: string;
  /** Read before the model's name on its button, e.g. "Model". */
  model: string;
  chooseModel: string;
  chooseEffort: string;
  dictate: string;
  stopDictation: string;
  send: string;
  stop: string;
}

export interface PromptBarProps {
  placeholder?: string;
  /** Text already in the box when it first renders (a draft handed over from elsewhere). */
  defaultDraft?: string;
  labels?: Partial<PromptBarLabels>;
  sources?: PromptBarSource[];
  commands?: PromptBarCommand[];
  models?: PromptBarModel[];
  defaultModel?: string;
  /** Controlled model key: the app owns which model is chosen. */
  model?: string;
  onModelChange?: (model: PromptBarModel) => void;
  /** A last row in the model menu, e.g. "Connect more…". */
  modelAction?: PromptBarModelAction;
  /** What the model button shows instead of the name and detail (e.g. a crossfade). */
  modelLabel?: ReactNode;
  /** The model menu's width. Pixels, or any CSS length. */
  modelMenuWidth?: number | string;
  efforts?: (string | PromptBarEffort)[];
  defaultEffort?: string;
  /** Controlled effort key: the app owns which level is chosen. */
  effort?: string;
  onEffortChange?: (effort: string) => void;
  /** A line under the levels, e.g. why some are off for this model. */
  effortNote?: ReactNode;
  busy?: boolean;
  onSend?: (text: string, detail: PromptBarSendDetail) => void;
  onStop?: () => void;
  onAttach?: () => string | string[] | void | Promise<string | string[] | void>;
  onDictate?: () => string | void | Promise<string | void>;
  background?: string;
  color?: string;
  /** Labels on the bar's buttons. Default: the ink at 70% (upstream). */
  secondaryColor?: string;
  /** Quieter text: hints, group headings, "Faster" and "Smarter". Default: the ink at 55% (upstream). */
  mutedColor?: string;
  /** A hairline round the bar, e.g. 'var(--color-rule)'. Default none (upstream). */
  rule?: string;
  menuBackground?: string;
  /** A hairline round the menus. Default none (upstream). */
  menuRule?: string;
  sparkColor?: string;
  /** The effort track's fill at maximum. Default: the spark colour at 35% (upstream). */
  sparkWash?: string;
  sparkBoost?: number;
  /** The particle field and glow at maximum effort. Off in Taalcut (no ambient loops). */
  sparks?: boolean;
  /** Pixels, or any CSS length. */
  width?: number | string;
  /** Pixels, or any CSS length such as a token: 'var(--radius-xl)'. */
  radius?: number | string;
  maxRows?: number;
  morphDuration?: number;
  squash?: number;
  tilt?: number;
  pressScale?: number;
  className?: string;
  /** Shown inside the bar above the text box, e.g. the app's own chips for what the message points at. */
  attachmentsSlot?: ReactNode;
  /** The app's own controls in the bar's tool row, after the model and thinking buttons (e.g. a recipes menu). */
  toolsSlot?: ReactNode;
}

type Row = {
  key: string;
  name: string;
  description?: string;
  tag?: string;
  icon?: ReactNode | LucideIcon;
  attach?: boolean;
  group?: string;
  /** The model menu's action row. */
  action?: boolean;
};
type Level = Required<Pick<PromptBarEffort, 'key' | 'name'>> & PromptBarEffort;
type Token = { kind: 'at' | 'slash'; query: string; start: number };
type Latest = Pick<
  PromptBarProps,
  'onSend' | 'onStop' | 'onAttach' | 'onDictate' | 'onEffortChange' | 'onModelChange'
>;
type Spark = {
  x: number;
  y: number;
  r: number;
  vy: number;
  sway: number;
  phase: number;
  life: number;
  span: number;
};

interface SendGlyphProps {
  busy: boolean;
  morphDuration: number;
  squash: number;
  tilt: number;
}

const ARROW_UP = [12, 4.5, 18.5, 11, 14.25, 11, 14.25, 19.5, 9.75, 19.5, 9.75, 11, 5.5, 11];
const SQUARE = [12, 6, 18, 6, 18, 12, 18, 18, 6, 18, 6, 12, 6, 6];
const EASE_IN_OUT: [number, number, number, number] = [0.77, 0, 0.175, 1];
const LINE = 22;
const EDGE = 11;

const DEFAULT_SOURCES: PromptBarSource[] = [
  {
    key: 'files',
    name: 'Photos & files',
    description: 'Upload from this device',
    icon: Paperclip,
    attach: true
  },
  { key: 'web', name: 'Web search', description: 'Live results', icon: Globe },
  { key: 'sales', name: 'Sales data', description: 'Revenue and churn', icon: ChartLine },
  { key: 'docs', name: 'Documents', description: 'Specs, notes, briefs', icon: File },
  { key: 'mail', name: 'Mail', description: 'Read and draft mail', icon: Mail },
  { key: 'calendar', name: 'Calendar', description: 'Events and availability', icon: Calendar }
];
const DEFAULT_COMMANDS: PromptBarCommand[] = [
  { key: 'summarize', name: '/summarize', description: 'Digest the thread so far' },
  { key: 'compare', name: '/compare', description: 'Two options side by side' },
  { key: 'draft', name: '/draft', description: 'Write a first version' },
  { key: 'explain', name: '/explain', description: 'A plain-language walkthrough' },
  { key: 'tasks', name: '/tasks', description: 'Turn this into a to-do list' }
];
const DEFAULT_MODELS: PromptBarModel[] = [
  { key: 'nova-3', name: 'Nova 3', tag: 'Flagship' },
  { key: 'nova-mini', name: 'Nova Mini', tag: 'Fast' },
  { key: 'nova-2', name: 'Nova 2', tag: 'Legacy' }
];
const DEFAULT_EFFORTS = ['Low', 'Medium', 'High', 'Extra', 'Max'];
const DEFAULT_LABELS: PromptBarLabels = {
  sources: 'Sources',
  commands: 'Commands',
  models: 'Models',
  effort: 'Effort',
  effortHint: 'Higher effort thinks longer before answering',
  faster: 'Faster',
  smarter: 'Smarter',
  noMatches: query => `No matches for “${query}”`,
  remove: file => `Remove ${file}`,
  listening: 'Listening…',
  prompt: 'Prompt',
  addSources: 'Add files and sources',
  model: 'Model',
  chooseModel: 'Choose model',
  chooseEffort: 'Choose effort',
  dictate: 'Dictate',
  stopDictation: 'Stop dictation',
  send: 'Send',
  stop: 'Stop'
};
const px = (value: number | string) => (typeof value === 'number' ? `${value}px` : value);

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const pathAt = (a: number[], b: number[], t: number) => {
  let d = '';
  for (let i = 0; i < a.length; i += 2) {
    d += `${i ? 'L' : 'M'}${mix(a[i]!, b[i]!, t).toFixed(2)} ${mix(a[i + 1]!, b[i + 1]!, t).toFixed(2)}`;
  }
  return `${d}Z`;
};

const parseToken = (draft: string): Token | null => {
  const m = /(^|\s)([@/])([\w-]*)$/.exec(draft);
  if (!m) return null;
  return { kind: m[2] === '@' ? 'at' : 'slash', query: m[3]!.toLowerCase(), start: m.index + m[1]!.length };
};

const renderIcon = (icon: ReactNode | LucideIcon, size: number) =>
  isValidElement(icon) || !icon || (typeof icon !== 'function' && typeof icon !== 'object')
    ? (icon as ReactNode)
    : createElement(icon as LucideIcon, { size, strokeWidth: 1.8 });

function SendGlyph({ busy, morphDuration, squash, tilt }: SendGlyphProps) {
  const reduce = useReducedMotion();
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const dir = useRef(busy ? 1 : -1);
  const t = useMotionValue(busy ? 1 : 0);

  useEffect(() => {
    const target = busy ? 1 : 0;
    dir.current = busy ? 1 : -1;
    if (t.get() === target) return undefined;
    const controls = animate(
      t,
      target,
      reduce ? { duration: 0 } : { duration: morphDuration / 1000, ease: EASE_IN_OUT }
    );
    return () => controls.stop();
  }, [busy, morphDuration, reduce, t]);

  useMotionValueEvent(t, 'change', v => {
    pathRef.current?.setAttribute('d', pathAt(ARROW_UP, SQUARE, v));
    const goo = reduce ? 0 : Math.sin(v * Math.PI);
    const sx = 1 - squash * goo;
    if (svgRef.current) {
      svgRef.current.style.transform = goo ? `rotate(${dir.current * tilt * goo}deg) scale(${sx}, ${1 / sx})` : '';
    }
  });

  return (
    <svg
      ref={svgRef}
      className="block h-4 w-4 origin-center"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    >
      <path ref={pathRef} d={pathAt(ARROW_UP, SQUARE, t.get())} />
    </svg>
  );
}

/**
 * Taalcut: the effort button's glyph, a small beat meter in place of
 * upstream's sparkle. One bar per level, rising; the bars up to the chosen
 * level are solid, the rest faint, and they fade between (opacity only).
 */
function BeatMeter({ level, count }: { level: number; count: number }) {
  const bars = Math.max(1, count);
  const gap = 12 / bars;
  // Taalcut: up to seven levels; past four the bars thin so a gap stays between them.
  const width = Math.min(2, gap * 0.7);
  return (
    <svg className="block h-3.5 w-3.5 flex-none" viewBox="0 0 14 14" aria-hidden="true" fill="currentColor">
      {Array.from({ length: bars }, (_, i) => {
        const height = 4 + (8 * (i + 1)) / bars;
        return (
          <rect
            key={i}
            x={1 + i * gap + (gap - width) / 2}
            y={13 - height}
            width={width}
            height={height}
            rx={1}
            className="[transition:opacity_120ms_var(--ease-out)] motion-reduce:[transition:none]"
            opacity={i <= level ? 1 : 0.3}
          />
        );
      })}
    </svg>
  );
}

const asLevel = (effort: string | PromptBarEffort): Level =>
  typeof effort === 'string' ? { key: effort, name: effort } : effort;

// Keyframes prompt-bar-pop and prompt-bar-eq live in react-bits.css: the
// app's CSP (style-src 'self') blocks inline <style> elements.

const PromptBar: React.FC<PromptBarProps> = ({
  placeholder = 'Ask anything',
  defaultDraft = '',
  labels: labelOverrides,
  sources = DEFAULT_SOURCES,
  commands = DEFAULT_COMMANDS,
  models = DEFAULT_MODELS,
  defaultModel = '',
  model: controlledModel,
  onModelChange,
  modelAction,
  modelLabel,
  modelMenuWidth = 200,
  efforts: effortInput = DEFAULT_EFFORTS,
  defaultEffort = '',
  effort: controlledEffort,
  onEffortChange,
  effortNote,
  busy = false,
  onSend,
  onStop,
  onAttach,
  onDictate,
  background = 'var(--color-raised)',
  color = 'var(--color-ink)',
  secondaryColor = 'color-mix(in srgb, var(--pb-ink) 70%, transparent)',
  mutedColor = 'color-mix(in srgb, var(--pb-ink) 55%, transparent)',
  rule = 'transparent',
  menuBackground = 'var(--color-popover)',
  menuRule = 'transparent',
  sparkColor = 'var(--color-ai)',
  sparkWash = 'color-mix(in srgb, var(--pb-spark) 35%, transparent)',
  sparkBoost = 1,
  sparks = true,
  width = 400,
  radius = 'var(--radius-xl)',
  maxRows = 5,
  morphDuration = 240,
  squash = 0.12,
  tilt = 8,
  pressScale = 0.96,
  className = '',
  attachmentsSlot,
  toolsSlot
}) => {
  const reduce = useReducedMotion();
  const labels: PromptBarLabels = { ...DEFAULT_LABELS, ...labelOverrides };
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const glowRef = useRef<HTMLSpanElement>(null);
  const sparkRef = useRef<HTMLCanvasElement>(null);
  const typing = useRef({ energy: 0, strokes: 0 });
  const boost = useRef(sparkBoost);
  boost.current = sparkBoost;
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const modelButton = useRef<HTMLButtonElement>(null);
  const effortButton = useRef<HTMLButtonElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  /** The open menu came from the keyboard: focus moves into it, and back to its button after. */
  const byKeyboard = useRef(false);
  const lastOpen = useRef<string | null>(null);
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** Taalcut: a menu opens above the bar, or below when it fits better there, never past its scroll box. */
  const [place, setPlace] = useState<{ side: 'above' | 'below'; room: number }>({ side: 'above', room: 320 });
  const dictation = useRef(0);
  const latest = useRef<Latest>({});
  latest.current = { onSend, onStop, onAttach, onDictate, onEffortChange, onModelChange };
  const efforts = useMemo(() => effortInput.map(asLevel), [effortInput]);

  const [draft, setDraft] = useState(defaultDraft);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [modelKey, setModelKey] = useState(defaultModel);
  const [plusOpen, setPlusOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [effortOpen, setEffortOpen] = useState(false);
  const [ownEffortIndex, setEffortIndex] = useState(() => {
    const i = efforts.findIndex(e => e.key === defaultEffort);
    return i >= 0 ? i : Math.max(0, Math.floor((efforts.length - 1) / 2));
  });
  const controlledIndex = controlledEffort === undefined ? -1 : efforts.findIndex(e => e.key === controlledEffort);
  const effortIndex = controlledIndex >= 0 ? controlledIndex : ownEffortIndex;
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const [listening, setListening] = useState(false);
  const [pressed, setPressed] = useState(false);

  const model = models.find(m => m.key === (controlledModel ?? modelKey)) ?? models[0];
  const token = dismissed ? null : parseToken(draft);
  const open = plusOpen ? 'at' : (token?.kind ?? (modelOpen ? 'model' : effortOpen ? 'effort' : null));
  const query = plusOpen ? '' : (token?.query ?? '');
  const list = useMemo<Row[]>(() => {
    if (open === 'at') return sources.filter(s => s.name.toLowerCase().includes(query));
    if (open === 'slash') return commands.filter(c => c.name.replace(/^\//, '').toLowerCase().startsWith(query));
    if (open === 'model')
      return modelAction ? [...models, { key: '\u0000action', name: modelAction.label, action: true }] : models;
    return [];
  }, [open, query, sources, commands, models, modelAction]);
  const cursor = Math.min(active, Math.max(0, list.length - 1));
  const canSend = draft.trim().length > 0 || attachments.length > 0;
  const armed = busy || canSend;
  const current = efforts[effortIndex];
  const level = current?.name ?? '';
  const maxed = efforts.length > 1 && effortIndex === efforts.length - 1;
  const usable = efforts.flatMap((e, i) => (e.disabled ? [] : [i]));

  const focusInput = () => inputRef.current?.focus({ preventScroll: true });
  const closeMenus = useCallback(() => {
    setPlusOpen(false);
    setModelOpen(false);
    setEffortOpen(false);
  }, []);
  /** Closes a menu and puts focus where it belongs: its button when it was opened from the keyboard. */
  const settle = (button: HTMLButtonElement | null) => {
    closeMenus();
    if (byKeyboard.current) button?.focus({ preventScroll: true });
    else focusInput();
    byKeyboard.current = false;
  };
  const holding = useRef(false);
  /**
   * After a menu button: from the keyboard, focus goes into the menu (its
   * chosen row, or the slider); from the pointer it stays in the box, as
   * upstream, so typing goes on.
   */
  const openFrom = (keyboard: boolean, target: () => HTMLElement | null | undefined) => {
    byKeyboard.current = keyboard;
    if (keyboard) {
      requestAnimationFrame(() => target()?.focus({ preventScroll: true }));
      return;
    }
    holding.current = true;
    focusInput();
    holding.current = false;
  };
  /** Arrow keys, Home and End move through the rows; Escape closes and goes back to the button. */
  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!list.length) return;
    const move = (to: number) => {
      e.preventDefault();
      setActive(to);
      rowRefs.current[to]?.focus({ preventScroll: false });
    };
    if (e.key === 'ArrowDown') move((cursor + 1) % list.length);
    else if (e.key === 'ArrowUp') move((cursor + list.length - 1) % list.length);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(list.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      if (open === 'model') settle(modelButton.current);
      else {
        closeMenus();
        focusInput();
      }
    } else if (e.key === 'Tab') {
      closeMenus();
      byKeyboard.current = false;
    }
  };
  /** The menu's rows in their groups, in order, each with its index in the list. */
  const sections = (rows: readonly Row[]) => {
    const out: { key: string; label?: string; action?: boolean; rows: { row: Row; i: number }[] }[] = [];
    rows.forEach((row, i) => {
      const label = row.action ? undefined : row.group;
      const last = out.at(-1);
      if (last && last.label === label && !last.action && !row.action) last.rows.push({ row, i });
      else out.push({ key: `${row.action ? 'action' : (label ?? '')}:${i}`, label, action: row.action, rows: [{ row, i }] });
    });
    return out;
  };

  useLayoutEffect(() => {
    const glow = glowRef.current;
    if (!glow || !open) return;
    const row = rowRefs.current[cursor];
    if (!row) {
      glow.style.opacity = '0';
      return;
    }
    const fresh = lastOpen.current !== open;
    lastOpen.current = open;
    if (fresh) glow.style.transition = 'none';
    glow.style.height = `${row.offsetHeight}px`;
    glow.style.transform = `translateY(${row.offsetTop}px)`;
    glow.style.opacity = '1';
    if (fresh) {
      void glow.offsetHeight;
      glow.style.transition = '';
    }
  }, [open, cursor, list]);
  useEffect(() => {
    if (!open) lastOpen.current = null;
  }, [open]);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const menu = menuRef.current;
    if (!open || !root || !menu) return;
    const bar = root.getBoundingClientRect();
    let top = 0;
    let bottom = window.innerHeight;
    for (let el = root.parentElement; el; el = el.parentElement) {
      if (/auto|scroll|hidden|clip/.test(getComputedStyle(el).overflowY)) {
        const box = el.getBoundingClientRect();
        top = Math.max(top, box.top);
        bottom = Math.min(bottom, box.bottom);
        break;
      }
    }
    const above = bar.top - top - 24;
    const below = bottom - bar.bottom - 24;
    const natural = listRef.current ? listRef.current.scrollHeight + 10 : menu.offsetHeight;
    const side = natural > above && below > above ? 'below' : 'above';
    setPlace({ side, room: Math.max(120, Math.floor(side === 'below' ? below : above)) });
  }, [open]);

  useEffect(() => {
    if (!plusOpen && !modelOpen && !effortOpen) return undefined;
    const onDown = (e: globalThis.PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) closeMenus();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [plusOpen, modelOpen, effortOpen, closeMenus]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '0px';
    const max = LINE * maxRows;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [draft, maxRows]);

  useEffect(
    () => () => {
      dictation.current += 1;
    },
    []
  );

  useEffect(() => {
    const canvas = sparkRef.current;
    if (!sparks || !maxed || reduce || !canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    typing.current.strokes = 0;
    let raf = 0;
    let last = performance.now();
    let w = 0;
    let h = 0;
    let due = 0;
    let speed = 1;
    let pulse = 0;
    const parts: Spark[] = [];
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const spawn = (burst: boolean) => {
      parts.push({
        x: Math.random() * w,
        y: burst ? h * (0.2 + Math.random() * 0.8) : h + 3,
        r: 0.9 + Math.random() * 1.1,
        vy: -(7 + Math.random() * 9),
        sway: (Math.random() - 0.5) * 10,
        phase: Math.random() * Math.PI * 2,
        life: burst ? Math.random() * 1.2 : 0,
        span: 2.4 + Math.random() * 2.4
      });
    };
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const typed = typing.current;
      const gain = boost.current;
      typed.energy *= Math.exp(-dt / 0.8);
      pulse *= Math.exp(-dt / 0.16);
      if (typed.strokes > 0) {
        typed.strokes = 0;
        if (gain > 0) pulse = 1;
      }
      const energy = typed.energy * gain;
      speed += (1 + energy * 6 - speed) * (1 - Math.exp(-dt / 0.15));
      due += dt;
      while (due > 0.14) {
        due -= 0.14;
        if (parts.length < 30) spawn(false);
      }
      ctx.clearRect(0, 0, w, h);
      // Canvas can't read var(): resolve the token at draw time (DESIGN.md).
      const spark = getComputedStyle(canvas).getPropertyValue('--pb-spark').trim() || sparkColor;
      ctx.fillStyle = spark;
      ctx.shadowColor = spark;
      ctx.shadowBlur = 6 + energy * 10 + pulse * 6;
      for (let i = parts.length - 1; i >= 0; i -= 1) {
        const p = parts[i]!;
        p.life += dt;
        if (p.life > p.span) {
          parts.splice(i, 1);
          continue;
        }
        const k = p.life / p.span;
        const twinkle = 0.7 + 0.3 * Math.sin((now / 160) * (1 + energy) + p.phase);
        p.y += p.vy * dt * speed;
        if (p.y < -4) {
          p.y = h + 3;
          p.x = Math.random() * w;
        }
        const edge = Math.min(1, Math.max(0, p.y / 14), Math.max(0, (h - p.y) / 14));
        ctx.globalAlpha = Math.min(1, Math.sin(k * Math.PI) * (0.9 + energy * 0.25) * twinkle) * edge;
        ctx.beginPath();
        ctx.arc(
          p.x + Math.sin((now / 900) * (1 + energy * 0.8) + p.phase) * p.sway,
          p.y,
          p.r * twinkle * (1 + energy * 0.35),
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    resize();
    for (let i = 0; i < 26; i += 1) spawn(true);
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      ctx.clearRect(0, 0, w, h);
    };
  }, [sparks, maxed, reduce, sparkColor]);

  /** Moves to a level; one the model doesn't have gives way to the nearest it does (lower first). */
  const setEffort = (i: number) => {
    const wanted = Math.max(0, Math.min(efforts.length - 1, i));
    const next = usable.reduce<number | undefined>(
      (best, u) =>
        best === undefined || Math.abs(u - wanted) < Math.abs(best - wanted) ? u : best,
      undefined,
    );
    if (next === undefined || next === effortIndex) return;
    setEffortIndex(next);
    latest.current.onEffortChange?.(efforts[next]!.key);
  };
  const effortFromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const k = (e.clientX - rect.left - EDGE) / Math.max(1, rect.width - 2 * EDGE);
    setEffort(Math.round(k * (efforts.length - 1)));
  };
  /** The next level the model has, `step` away (keys skip the ones it doesn't). */
  const stepFrom = (from: number, step: number) =>
    step > 0 ? (usable.find(u => u > from) ?? from) : (usable.findLast(u => u < from) ?? from);
  const onEffortKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (step) {
      e.preventDefault();
      setEffort(stepFrom(effortIndex, step));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setEffort(usable[0] ?? 0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setEffort(usable.at(-1) ?? 0);
    } else if (e.key === 'Escape' || e.key === 'Enter') {
      e.preventDefault();
      settle(effortButton.current);
    }
  };
  const stepAt = (i: number) =>
    `calc(${EDGE}px + (100cqw - ${EDGE * 2}px) * ${i / Math.max(1, efforts.length - 1)})`;
  const fillAt = (i: number) => (i === efforts.length - 1 ? '100cqw' : `calc(${stepAt(i)} + 7px)`);

  const pick = (row: Row) => {
    if (open === 'model') {
      if (row.action) {
        closeMenus();
        byKeyboard.current = false;
        modelAction?.onSelect();
        return;
      }
      setModelKey(row.key);
      const chosen = models.find(m => m.key === row.key);
      if (chosen) latest.current.onModelChange?.(chosen);
      settle(modelButton.current);
      return;
    }
    const head = token ? draft.slice(0, token.start) : draft;
    if (row.attach) {
      setDraft(head);
      Promise.resolve(latest.current.onAttach?.()).then(files => {
        if (!files) return;
        setAttachments(a => [...a, ...(Array.isArray(files) ? files : [files])]);
      });
    } else if (open === 'at') {
      setDraft(`${head}@${row.name} `);
    } else {
      setDraft(`${head}${row.name} `);
    }
    setPlusOpen(false);
    setDismissed(false);
    focusInput();
  };

  const send = () => {
    if (!canSend || busy) return;
    latest.current.onSend?.(draft.trim(), { attachments, model, effort: level });
    setDraft('');
    setAttachments([]);
    setDismissed(false);
    closeMenus();
    focusInput();
  };

  const toggleListen = () => {
    if (listening) {
      dictation.current += 1;
      setListening(false);
      return;
    }
    const seq = ++dictation.current;
    setListening(true);
    Promise.resolve(latest.current.onDictate?.()).then(
      text => {
        if (seq !== dictation.current) return;
        setListening(false);
        if (text) setDraft(d => (d.trim() ? `${d.trimEnd()} ${text}` : text));
        focusInput();
      },
      () => {
        if (seq === dictation.current) setListening(false);
      }
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && list.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((cursor + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length);
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        pick(list[cursor]!);
        return;
      }
    }
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setDismissed(true);
        closeMenus();
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const down = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || !armed) return;
    setPressed(true);
  };
  const up = () => setPressed(false);

  return (
    <div
      ref={rootRef}
      className={`group relative text-base leading-[22px] [width:min(var(--pb-w),100%)] [color:var(--pb-ink)]${className ? ` ${className}` : ''}`}
      data-busy={busy ? '' : undefined}
      data-max={maxed ? '' : undefined}
      style={
        {
          '--pb-bg': background,
          '--pb-ink': color,
          '--pb-ink-2': secondaryColor,
          '--pb-muted': mutedColor,
          '--pb-rule': rule,
          '--pb-menu': menuBackground,
          '--pb-menu-rule': menuRule,
          '--pb-model-w': px(modelMenuWidth),
          '--pb-w': px(width),
          '--pb-radius': px(radius),
          '--pb-spark': sparkColor,
          '--pb-spark-wash': sparkWash,
          '--pb-press': pressScale
        } as CSSProperties
      }
    >
      {open ? (
        <div
          ref={menuRef}
          className="absolute inset-x-0 bottom-[calc(100%+8px)] z-[2] origin-bottom rounded-xl p-1 shadow-md [animation:prompt-bar-pop_180ms_var(--ease-out)_both] data-[side=below]:top-[calc(100%+8px)] data-[side=below]:bottom-auto data-[side=below]:[animation-name:prompt-bar-drop] [background:var(--pb-menu)] [box-shadow:0_0_0_1px_var(--pb-menu-rule),var(--shadow-md)] data-[kind=model]:right-auto data-[kind=model]:w-[min(var(--pb-model-w),100%)] data-[kind=model]:origin-bottom-left data-[kind=effort]:right-auto data-[kind=effort]:w-[min(264px,100%)] data-[kind=effort]:origin-bottom-left data-[kind=effort]:px-3.5 data-[kind=effort]:pt-3 data-[kind=effort]:pb-3.5 motion-reduce:[animation:none]"
          role={open === 'effort' ? 'dialog' : undefined}
          aria-label={open === 'effort' ? labels.effort : undefined}
          data-kind={open}
          data-side={place.side}
        >
          {open === 'effort' ? (
            <>
              <div className="flex items-center gap-2 text-sm leading-[18px]">
                <span className="[color:var(--pb-muted)]">{labels.effort}</span>
                <span className="font-medium">{level}</span>
              </div>
              <div className="mt-3 flex justify-between text-xs leading-4 [color:var(--pb-muted)]">
                <span>{labels.faster}</span>
                <span>{labels.smarter}</span>
              </div>
              <div
                ref={sliderRef}
                className="relative mt-2 h-[22px] cursor-pointer touch-none rounded-[11px] select-none [container-type:inline-size] [background:color-mix(in_srgb,var(--pb-ink)_8%,transparent)] aria-disabled:cursor-default"
                role="slider"
                tabIndex={0}
                aria-label={labels.effort}
                aria-valuemin={0}
                aria-valuemax={efforts.length - 1}
                aria-valuenow={effortIndex}
                aria-valuetext={level}
                aria-disabled={usable.length < 2 || undefined}
                style={
                  { '--pb-effort-x': stepAt(effortIndex), '--pb-effort-fill': fillAt(effortIndex) } as CSSProperties
                }
                onPointerDown={e => {
                  if (e.button !== 0) return;
                  try {
                    e.currentTarget.setPointerCapture(e.pointerId);
                  } catch {}
                  e.currentTarget.focus({ preventScroll: true });
                  effortFromPointer(e);
                }}
                onPointerMove={e => {
                  if (e.buttons & 1) effortFromPointer(e);
                }}
                onKeyDown={onEffortKey}
              >
                <span className="absolute inset-0 overflow-hidden rounded-[11px]">
                  <span className="absolute inset-y-0 left-0 w-full rounded-[11px] [transform:translateX(calc(var(--pb-effort-fill)-100%))] [background:color-mix(in_srgb,var(--pb-ink)_18%,transparent)] [transition:transform_220ms_var(--ease-out),background-color_220ms_var(--ease-out)] group-data-[max]:[background:var(--pb-spark-wash)] motion-reduce:[transition:background-color_150ms_linear]" />
                </span>
                {efforts.map((step, i) => (
                  <i
                    key={step.key}
                    className="absolute top-1/2 -mt-0.5 -ml-0.5 h-1 w-1 rounded-full [background:color-mix(in_srgb,var(--pb-ink)_30%,transparent)] data-[off]:-mt-[3px] data-[off]:-ml-[3px] data-[off]:h-1.5 data-[off]:w-1.5 data-[off]:[background:transparent] data-[off]:[box-shadow:inset_0_0_0_1px_color-mix(in_srgb,var(--pb-ink)_45%,transparent)]"
                    data-off={step.disabled ? '' : undefined}
                    style={{ left: stepAt(i) }}
                  />
                ))}
                <span className="absolute -top-[3px] left-0 h-7 w-3.5 rounded-[7px] shadow-sm [transform:translateX(calc(var(--pb-effort-x)-7px))] [background:var(--pb-ink)] [transition:transform_220ms_var(--ease-out),background-color_220ms_var(--ease-out)] group-data-[max]:[background:var(--pb-spark)] motion-reduce:[transition:background-color_150ms_linear]" />
              </div>
              {current?.description ? (
                <p className="m-0 mt-3 text-sm leading-[18px] [color:var(--pb-ink)]">
                  {current.description}
                </p>
              ) : null}
              {effortNote ? (
                <p className="m-0 mt-1.5 text-xs leading-4 [color:var(--pb-muted)]">
                  {effortNote}
                </p>
              ) : null}
            </>
          ) : (
            <div
              ref={listRef}
              id={menuId}
              className="relative max-h-[min(20rem,var(--pb-room))] overflow-y-auto overscroll-contain"
              style={{ '--pb-room': `${place.room}px` } as CSSProperties}
              role="listbox"
              aria-label={
                open === 'at' ? labels.sources : open === 'slash' ? labels.commands : labels.models
              }
              onKeyDown={onMenuKey}
            >
              <span
                ref={glowRef}
                className="pointer-events-none absolute inset-x-0 top-0 rounded-lg opacity-0 [background:color-mix(in_srgb,var(--pb-ink)_8%,transparent)] [transition:transform_220ms_var(--ease-out),opacity_120ms_var(--ease-out)] motion-reduce:[transition:opacity_150ms_linear]"
                aria-hidden="true"
              />
              {sections(list).map(section => (
                <div
                  key={section.key}
                  role={section.label !== undefined || section.action ? 'group' : undefined}
                  aria-label={section.label}
                  className="data-[action]:mt-1 data-[action]:pt-1 data-[action]:[box-shadow:inset_0_1px_0_var(--pb-menu-rule)]"
                  data-action={section.action ? '' : undefined}
                >
                  {section.label !== undefined ? (
                    <div
                      className="px-2 pt-2 pb-1 text-2xs leading-4 font-medium [color:var(--pb-muted)]"
                      aria-hidden="true"
                    >
                      {section.label}
                    </div>
                  ) : null}
                  {section.rows.map(({ row, i }) => (
                    <button
                      key={row.key}
                      id={`${menuId}-${i}`}
                      ref={el => {
                        rowRefs.current[i] = el;
                      }}
                      type="button"
                      role="option"
                      aria-selected={open === 'model' ? !row.action && row.key === model?.key : i === cursor}
                      tabIndex={i === cursor ? 0 : -1}
                      className="relative z-[1] flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-2 text-left text-inherit [font:inherit] [-webkit-tap-highlight-color:transparent]"
                      onMouseDown={e => e.preventDefault()}
                      onPointerEnter={() => setActive(i)}
                      onClick={() => pick(row)}
                    >
                      {open === 'at' || row.action || Boolean(row.icon) ? (
                        <span className="inline-flex w-5 flex-none justify-center [color:var(--pb-ink-2)]">
                          {row.action ? <Plus size={15} strokeWidth={1.8} /> : renderIcon(row.icon, 15)}
                        </span>
                      ) : null}
                      <span
                        className="min-w-0 flex-none truncate text-sm font-medium data-[action]:font-normal"
                        translate={open === 'model' && !row.action ? 'no' : undefined}
                        data-action={row.action ? '' : undefined}
                      >
                        {row.name}
                      </span>
                      {row.description ? (
                        <span className="min-w-0 flex-auto truncate text-xs [color:var(--pb-muted)]">
                          {row.description}
                        </span>
                      ) : null}
                      {open === 'model' && !row.action ? (
                        <>
                          <span className="ml-auto flex-none text-2xs [color:var(--pb-muted)]">
                            {row.tag}
                          </span>
                          <span
                            className="inline-flex w-4 flex-none justify-center opacity-0 data-[on]:opacity-100"
                            data-on={row.key === model?.key ? '' : undefined}
                          >
                            <Check size={13} strokeWidth={2.5} />
                          </span>
                        </>
                      ) : null}
                    </button>
                  ))}
                </div>
              ))}
              {list.length === 0 ? (
                <div className="flex h-9 items-center px-2 text-xs [color:var(--pb-muted)]">
                  {labels.noMatches(query)}
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      <div
        className="relative isolate flex cursor-text flex-col gap-2 p-3 [background:var(--pb-bg)] [border-radius:var(--pb-radius)] [box-shadow:0_0_0_1px_var(--pb-rule)] has-[textarea:focus-visible]:[box-shadow:0_0_0_2px_var(--color-focus)] window-inactive:has-[textarea:focus-visible]:[box-shadow:0_0_0_1px_var(--pb-rule)] before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:opacity-0 before:content-[''] before:[background:radial-gradient(140%_120%_at_0%_100%,color-mix(in_srgb,var(--pb-spark)_26%,transparent),transparent_62%)] before:[transition:opacity_500ms_var(--ease-out)] data-[max]:before:opacity-100"
        role="presentation"
        data-max={maxed && sparks ? '' : undefined}
        onPointerDown={e => {
          if (e.target === e.currentTarget || e.target === inputRef.current) closeMenus();
        }}
        onClick={e => {
          // A button in the bar puts focus where it wants (into a menu it opened from the keyboard).
          if (!(e.target as Element).closest('button')) focusInput();
        }}
      >
        <canvas
          ref={sparkRef}
          className="pointer-events-none absolute inset-0 -z-10 h-full w-full rounded-[inherit]"
          aria-hidden="true"
        />
        {attachmentsSlot}
        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {attachments.map((file, i) => (
              <span
                key={`${file}-${i}`}
                className="inline-flex h-[26px] items-center gap-1.5 rounded-lg pr-1 pl-2 text-xs [animation:prompt-bar-pop_200ms_var(--ease-out)_both] [background:color-mix(in_srgb,var(--pb-ink)_8%,transparent)] motion-reduce:[animation:none]"
              >
                <File size={12} strokeWidth={2} />
                <span className="max-w-[144px] truncate">{file}</span>
                <button
                  type="button"
                  className="inline-grid h-[18px] w-[18px] cursor-pointer place-items-center rounded-[5px] border-0 bg-transparent p-0 text-inherit opacity-60 [transition:opacity_120ms_var(--ease-out),background-color_120ms_var(--ease-out)] hover:opacity-100 hover:[background:color-mix(in_srgb,var(--pb-ink)_10%,transparent)]"
                  aria-label={labels.remove(file)}
                  onClick={() => setAttachments(a => a.filter((_, j) => j !== i))}
                >
                  <X size={10} strokeWidth={2.5} />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <textarea
          ref={inputRef}
          className="block w-full resize-none border-0 bg-transparent p-0 text-base leading-[22px] text-inherit outline-none [font:inherit] [overflow-wrap:anywhere] placeholder:[color:var(--color-ink-3)] [@media(pointer:coarse)]:text-[16px]"
          rows={1}
          value={draft}
          placeholder={listening ? labels.listening : placeholder}
          aria-label={labels.prompt}
          aria-controls={open && open !== 'effort' ? menuId : undefined}
          aria-activedescendant={open && open !== 'effort' && list.length ? `${menuId}-${cursor}` : undefined}
          onChange={e => {
            setDraft(e.target.value);
            typing.current.energy = Math.min(1.6, typing.current.energy + 0.22);
            typing.current.strokes = Math.min(4, typing.current.strokes + 1);
            setDismissed(false);
            closeMenus();
            setActive(0);
          }}
          onFocus={() => {
            // A menu's own button focuses the box while it opens; anything else here closes it.
            if (!holding.current) closeMenus();
          }}
          onKeyDown={onKeyDown}
        />

        <div className="flex flex-wrap items-center gap-1">
          {sources.length > 0 ? (
          <button
            type="button"
            className="inline-grid h-7 w-7 flex-none cursor-pointer touch-manipulation place-items-center rounded-lg border-0 bg-transparent p-0 select-none [color:color-mix(in_srgb,var(--pb-ink)_60%,transparent)] [font:inherit] [-webkit-tap-highlight-color:transparent] [transition:background-color_150ms_var(--ease-out),color_150ms_var(--ease-out),transform_160ms_var(--ease-out)] active:[transform:scale(0.94)] data-[on]:[background:color-mix(in_srgb,var(--pb-ink)_8%,transparent)] data-[on]:[color:var(--pb-ink)] motion-reduce:active:[transform:none] [@media(hover:hover)_and_(pointer:fine)]:hover:[background:color-mix(in_srgb,var(--pb-ink)_8%,transparent)] [@media(hover:hover)_and_(pointer:fine)]:hover:[color:var(--pb-ink)]"
            aria-label={labels.addSources}
            aria-expanded={plusOpen}
            data-on={plusOpen ? '' : undefined}
            onMouseDown={e => e.preventDefault()}
            onClick={() => {
              setModelOpen(false);
              setEffortOpen(false);
              setActive(0);
              setPlusOpen(v => !v);
              focusInput();
            }}
          >
            <Plus size={16} strokeWidth={2} />
          </button>
          ) : null}
          {models.length > 0 ? (
            <button
              type="button"
              className="inline-flex h-7 min-w-0 flex-none cursor-pointer touch-manipulation items-center gap-1.5 rounded-lg border-0 bg-transparent px-2 text-xs font-medium whitespace-nowrap select-none [color:var(--pb-ink-2)] [font:inherit] [-webkit-tap-highlight-color:transparent] [transition:background-color_150ms_var(--ease-out),color_150ms_var(--ease-out),transform_160ms_var(--ease-out)] active:[transform:scale(0.97)] disabled:cursor-default disabled:[color:var(--pb-muted)] data-[on]:[background:color-mix(in_srgb,var(--pb-ink)_8%,transparent)] data-[on]:[color:var(--pb-ink)] motion-reduce:active:[transform:none] [@media(hover:hover)_and_(pointer:fine)]:enabled:hover:[background:color-mix(in_srgb,var(--pb-ink)_8%,transparent)] [@media(hover:hover)_and_(pointer:fine)]:enabled:hover:[color:var(--pb-ink)] data-[max]:[color:var(--pb-spark)]!"
              ref={modelButton}
              title={labels.chooseModel}
              aria-haspopup="listbox"
              aria-expanded={modelOpen}
              aria-controls={modelOpen ? menuId : undefined}
              data-on={modelOpen ? '' : undefined}
              onMouseDown={e => e.preventDefault()}
              onClick={e => {
                const opening = !modelOpen;
                const index = Math.max(0, model ? models.indexOf(model) : 0);
                setPlusOpen(false);
                setEffortOpen(false);
                setActive(index);
                setModelOpen(opening);
                openFrom(e.detail === 0 && opening, () => rowRefs.current[index]);
              }}
            >
              <span className="sr-only">{labels.model}:</span>{' '}
              {modelLabel ?? (
                <>
                  <span className="min-w-0 truncate" translate="no">
                    {model?.name}
                  </span>
                  {model?.detail ? <span className="[color:var(--pb-muted)]">{model.detail}</span> : null}
                </>
              )}
              <ChevronDown size={12} strokeWidth={2.4} aria-hidden="true" />
            </button>
          ) : null}
          {efforts.length > 0 ? (
            <button
              type="button"
              className="inline-flex h-7 min-w-0 flex-none cursor-pointer touch-manipulation items-center gap-1.5 rounded-lg border-0 bg-transparent px-2 text-xs font-medium whitespace-nowrap select-none [color:var(--pb-ink-2)] [font:inherit] [-webkit-tap-highlight-color:transparent] [transition:background-color_150ms_var(--ease-out),color_150ms_var(--ease-out),transform_160ms_var(--ease-out)] active:[transform:scale(0.97)] disabled:cursor-default disabled:[color:var(--pb-muted)] data-[on]:[background:color-mix(in_srgb,var(--pb-ink)_8%,transparent)] data-[on]:[color:var(--pb-ink)] motion-reduce:active:[transform:none] [@media(hover:hover)_and_(pointer:fine)]:enabled:hover:[background:color-mix(in_srgb,var(--pb-ink)_8%,transparent)] [@media(hover:hover)_and_(pointer:fine)]:enabled:hover:[color:var(--pb-ink)] data-[max]:[color:var(--pb-spark)]!"
              ref={effortButton}
              title={labels.chooseEffort}
              aria-haspopup="dialog"
              aria-expanded={effortOpen}
              data-on={effortOpen ? '' : undefined}
              data-max={maxed ? '' : undefined}
              onMouseDown={e => e.preventDefault()}
              onClick={e => {
                const opening = !effortOpen;
                setPlusOpen(false);
                setModelOpen(false);
                setEffortOpen(opening);
                openFrom(e.detail === 0 && opening, () => sliderRef.current);
              }}
            >
              <BeatMeter level={effortIndex} count={efforts.length} />
              <span className="sr-only">{labels.effort}:</span>{' '}
              <span>{level}</span>
            </button>
          ) : null}
          {toolsSlot}
          <span className="flex-auto" />
          {onDictate ? (
            <button
              type="button"
              className="inline-grid h-7 w-7 flex-none cursor-pointer touch-manipulation place-items-center rounded-lg border-0 bg-transparent p-0 select-none [color:color-mix(in_srgb,var(--pb-ink)_60%,transparent)] [font:inherit] [-webkit-tap-highlight-color:transparent] [transition:background-color_150ms_var(--ease-out),color_150ms_var(--ease-out),transform_160ms_var(--ease-out)] active:[transform:scale(0.94)] data-[on]:[background:color-mix(in_srgb,var(--pb-ink)_8%,transparent)] data-[on]:[color:var(--pb-ink)] motion-reduce:active:[transform:none] [@media(hover:hover)_and_(pointer:fine)]:hover:[background:color-mix(in_srgb,var(--pb-ink)_8%,transparent)] [@media(hover:hover)_and_(pointer:fine)]:hover:[color:var(--pb-ink)]"
              aria-label={listening ? labels.stopDictation : labels.dictate}
              aria-pressed={listening}
              data-on={listening ? '' : undefined}
              onMouseDown={e => e.preventDefault()}
              onClick={toggleListen}
            >
              {listening ? (
                <span
                  className="flex h-3.5 items-center gap-[2.5px] [&>i]:block [&>i]:h-full [&>i]:w-[2.5px] [&>i]:origin-center [&>i]:rounded-full [&>i]:bg-current [&>i]:[animation:prompt-bar-eq_900ms_var(--ease-in-out)_infinite] [&>i:nth-child(2)]:[animation-delay:150ms] [&>i:nth-child(3)]:[animation-delay:300ms]"
                  aria-hidden="true"
                >
                  <i />
                  <i />
                  <i />
                </span>
              ) : (
                <Mic size={15} strokeWidth={2} />
              )}
            </button>
          ) : null}
          <button
            type="button"
            className="relative inline-grid h-7 w-7 flex-none cursor-pointer touch-manipulation place-items-center rounded-lg border-0 p-0 select-none [font:inherit] [-webkit-tap-highlight-color:transparent] [transition:background-color_200ms_var(--ease-out),color_200ms_var(--ease-out),opacity_200ms_var(--ease-out),box-shadow_200ms_var(--ease-out),transform_160ms_var(--ease-out)] data-[state=idle]:cursor-not-allowed data-[state=idle]:opacity-45 data-[state=idle]:[background:color-mix(in_srgb,var(--pb-ink)_8%,var(--pb-bg))] data-[state=idle]:[color:color-mix(in_srgb,var(--pb-ink)_55%,var(--pb-bg))] data-[state=idle]:[box-shadow:inset_0_0_0_1px_var(--pb-rule)] data-[state=ready]:[background:var(--pb-ink)] data-[state=ready]:[color:var(--pb-bg)] data-[state=ready]:hover:opacity-90 data-[state=ready]:active:scale-95 data-[state=running]:[background:var(--color-danger-strong,var(--pb-ink))] data-[state=running]:[color:var(--color-canvas,var(--pb-bg))] data-[state=running]:[box-shadow:0_0_0_3px_color-mix(in_srgb,var(--color-danger-strong,#e03e2d)_22%,transparent)] data-[state=running]:hover:opacity-90 data-[state=running]:active:scale-95 data-[pressed]:[transform:scale(var(--pb-press))] motion-reduce:data-[pressed]:[transform:none]"
            disabled={!armed}
            aria-label={busy ? labels.stop : labels.send}
            data-state={busy ? 'running' : canSend ? 'ready' : 'idle'}
            data-armed={armed ? '' : undefined}
            data-pressed={pressed ? '' : undefined}
            onMouseDown={e => e.preventDefault()}
            onPointerDown={down}
            onPointerUp={up}
            onPointerCancel={up}
            onPointerLeave={up}
            onClick={() => {
              if (busy) latest.current.onStop?.();
              else send();
            }}
          >
            <SendGlyph busy={busy} morphDuration={morphDuration} squash={squash} tilt={tilt} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default PromptBar;
