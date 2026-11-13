// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The site's content contract (WEB1 phase 0). Every page, llms.txt, the .md mirrors, the JSON-LD and the claims test
 * read these shapes, so words and facts live in one place. Lanes add entries; only the foundation changes the shapes.
 */

/** Whether a capability is in the app today. The site only describes `shipped` work as present. */
export type Status = 'shipped' | 'partial' | 'planned';

/** A page the site publishes: its address, the words search and AI engines show, and where it sits. */
export interface PageEntry {
  /** Absolute path with a trailing slash, as exported (`/features/agent/`). */
  readonly path: string;
  readonly title: string;
  /** One or two sentences, under 160 characters: the meta description and the llms.txt line. */
  readonly description: string;
  /** The llms.txt section it is listed under. */
  readonly section: 'Product' | 'Features' | 'Company' | 'Legal';
  /** Left out of the sitemap and llms.txt (the 404). */
  readonly unlisted?: boolean;
}

/** A label and its value, shown as a facts table and read by engines as plain statements. */
export type Fact = readonly [label: string, value: string];

export interface Feature {
  readonly slug: string;
  /** 'reel': the five parts of making a video like a reel you saved; 'more': everything else Taalcut does (WEB3). */
  readonly group: 'reel' | 'more';
  readonly name: string;
  /** The answer-first definition: one sentence that says what it does, the page's opening line. */
  readonly definition: string;
  /** Two or three short sentences for the features index and the home page's index. */
  readonly summary: string;
  readonly facts: readonly Fact[];
  readonly status: Status;
}

export type PlatformId = 'macos' | 'ubuntu' | 'windows';

export interface Platform {
  readonly id: PlatformId;
  /** The OS by its own name, always written beside its SVGL icon (BrandIcon `apple`, `ubuntu`, `windows`). */
  readonly name: string;
  readonly status: 'supported' | 'coming-soon';
  readonly line: string;
  readonly requirements: readonly Fact[];
}

export type ProviderWay = 'subscription' | 'api-key' | 'on-device' | 'own-server';

export interface Provider {
  readonly id: string;
  readonly name: string;
  readonly way: ProviderWay;
  /** What it is used for, in a few words. */
  readonly does: string;
  /**
   * The brand's SVGL icon id (components/brand/svgl/manifest.ts: SVGL), or a brand SVGL lacks (SVGL_MISSING), which
   * shows as its name alone. Either way the name is written in words beside it.
   */
  readonly markId?: string;
}

export interface FaqEntry {
  readonly id: string;
  readonly question: string;
  /** Plain sentences. No markup: the page, FAQPage JSON-LD and llms-full.txt all print it as is. */
  readonly answer: string;
  readonly group: 'Making videos' | 'Your footage and privacy' | 'Your AI' | 'Platforms and price';
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* The hero's demonstration: a saved reel, its template, and the camera roll that fills it.                         */
/* ---------------------------------------------------------------------------------------------------------------- */

/** A slot's job in the reel, from Taalcut's breakdown. The colour of its label is the kind hue DESIGN.md gives it. */
export type SlotRole = 'hook' | 'build' | 'peak' | 'outro';

export interface Pick {
  /** The camera-roll clip that fills the slot (RollClip.id). */
  readonly clipId: string;
  /** One line of editing logic, the way the agent says it ("Widest frame, so it closes like the reel"). */
  readonly reason: string;
  /** How many other clips could fill it. The app offers 3. */
  readonly alternates: number;
}

export interface Slot {
  readonly id: string;
  readonly role: SlotRole;
  /** Start and end in seconds on the reel's clock. Rational time is the app's rule; the site only draws them. */
  readonly start: number;
  readonly end: number;
  /** What the slot needs, in the breakdown's words ("a wide shot that opens the place"). */
  readonly needs: string;
  readonly pick: Pick;
  /** The breakdown wasn't sure of this cut; the UI flags it (provenance raise). */
  readonly uncertainCut?: boolean;
}

export interface MediaSource {
  readonly src: string;
  readonly type: 'video/webm; codecs=av01' | 'video/webm' | 'video/mp4';
}

export interface Reel {
  /** The address of this cut: `/?reel=<id>`. Lowercase, a-z and hyphens. */
  readonly id: string;
  /** The shelf label: what kind of reel it is ("Trip", "Product"). */
  readonly label: string;
  readonly title: string;
  /** A short project name for the app window's title bar ("Vietnam trip"), where the full title would not fit. */
  readonly project?: string;
  readonly durationSec: number;
  /** Music beats a minute, folded into 60–180 for the logo's keep-time. Shown as "music beats", never "BPM". */
  readonly tempo: number;
  /** Beat times in seconds, from the breakdown. */
  readonly beats: readonly number[];
  readonly slots: readonly Slot[];
  readonly poster: string;
  /** The reel as saved (the reference) and the version Taalcut made from the roll. */
  readonly reference: readonly MediaSource[];
  readonly made: readonly MediaSource[];
  /**
   * Where the beats and slots come from: `breakdown` is Taalcut's own breakdown of the reel (the template JSON);
   * `estimated` is anything else (scene cuts, an even beat grid). The page labels an estimated template as such.
   */
  readonly timing: 'breakdown' | 'estimated';
  /** True while the entry is a placeholder waiting for the owner's footage. */
  readonly placeholder?: boolean;
}

export interface RollClip {
  readonly id: string;
  /** The day it was shot (ISO date): the roll groups by day under teal headings. */
  readonly day: string;
  /** Index into the roll's sprite atlas. */
  readonly sprite: number;
  readonly durationSec: number;
}

export interface CameraRoll {
  /** The sprite atlas of thumbnails, its grid, and one thumbnail's size in pixels. */
  readonly atlas: { readonly src: string; readonly columns: number; readonly rows: number; readonly cell: readonly [number, number] };
  readonly clips: readonly RollClip[];
  /** The number the page shows ("1,284 clips"); labelled as a sample camera roll. */
  readonly shownCount: number;
}
