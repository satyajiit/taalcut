// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Taalcut design tokens: the one place to edit.
// Run `node design/scripts/build-tokens.mjs` after any change. It regenerates
// tokens.css, tailwind.css, tokens.json, theme-meta.json and the contrast report,
// and exits non-zero if a contrast or gamut check fails.
//
// Colours are OKLCH triples: [lightness %, chroma, hue °].
// Vibe: "golden hour, on the beat" (warm cinematic, four accents with jobs).

export const meta = {
  name: 'Taalcut',
  version: '0.1.0',
  vibe: 'golden hour, on the beat',
  neutralHue: 65,
};

// Surfaces, ink and lines per theme.
//
// The scene (UX4): a creator trims their own phone footage late at night on a laptop in a dim room, the clip playing
// in a neutral grey viewer beside lists and chat. The chrome has to recede beside the footage, never tint it, and
// stay easy to read for an hour. So light keeps its warm paper, and dark is graphite: near-neutral (chroma 0.004,
// a trace of warmth at hue 65) so the four accents carry the warmth and the viewer's grey doesn't look cold beside it.
//
// The surface roles (both themes): canvas, the page. sidebar, the navigation plane, with its rows' -hover and
// -pressed kept below the current area's raised pill. sunken, a well in the page (timeline bed, a track); well, one
// inside a card. panel, a flat region set apart by tone, not lift (darker than the canvas in light, lighter in
// dark): a chat card with no border. bubble, the user's own message. chip, a neutral chip's wash. raised, cards and
// plates; overlay, menus and popovers. control, a neutral filled control (the secondary button) with -hover and
// -pressed. hover and pressed, a row's states; selected is marigold-soft. inverse, a solid ink fill in both themes
// (a checked box, the play disc, an ink chip); tooltip, ink in light and a graphite plate in dark, never a white
// flash; thumb, a switch's knob when off. on-inverse, on-tooltip and on-thumb are the text on those three.
export const neutrals = {
  light: {
    canvas: [97.5, 0.008, 75], // app background: warm paper
    sidebar: [94.8, 0.011, 72],
    'sidebar-hover': [92.6, 0.013, 72],
    'sidebar-pressed': [89.8, 0.015, 70],
    sunken: [94.8, 0.011, 72], // wells: timeline bed, tracks
    well: [95.8, 0.01, 72],
    panel: [94.8, 0.011, 72],
    bubble: [94.8, 0.011, 72],
    raised: [99.2, 0.004, 75], // cards and panels sit lighter than the canvas
    overlay: [99.6, 0.003, 75], // menus, popovers, dialogs
    chip: [94.8, 0.011, 72],
    control: [94.8, 0.011, 72],
    'control-hover': [92.6, 0.013, 72],
    'control-pressed': [89.8, 0.015, 70],
    hover: [92.6, 0.013, 72],
    pressed: [89.8, 0.015, 70],
    inverse: [21, 0.014, 55],
    'on-inverse': [97.5, 0.008, 75],
    tooltip: [21, 0.014, 55],
    'on-tooltip': [97.5, 0.008, 75],
    'tooltip-rule': [38, 0.014, 58],
    thumb: [99.2, 0.004, 75],
    'on-thumb': [49, 0.014, 60],
    ink: [21, 0.014, 55], // primary text
    'ink-2': [38, 0.014, 58], // secondary text
    'ink-3': [49, 0.014, 60], // tertiary text, placeholders
    'ink-disabled': [70, 0.01, 65],
    'rule-subtle': [92, 0.01, 70],
    rule: [87.5, 0.012, 70],
    'rule-strong': [62, 0.014, 65], // input borders: 3:1 against every resting surface
    focus: [60, 0.14, 58],
    // Text placed on accent fills is one of these two, whichever contrasts more.
    'on-fill-dark': [20, 0.02, 55],
    'on-fill-light': [99, 0.004, 75],
  },
  // UX4: graphite. Each layer is a step you can see (OKLCH lightness, the build holds the floors in `separation`):
  // the sidebar 4.5 below the canvas, raised 5.5 above it, then overlay, hover and pressed 3 apart, and both
  // hairlines above hover so a hovered row keeps its edge. The inks are lifted to APCA reading floors on every
  // surface, pressed included, and the top ink comes down from near-white so dense text doesn't glare.
  dark: {
    canvas: [20.5, 0.004, 65], // graphite
    sidebar: [16, 0.004, 65],
    'sidebar-hover': [21, 0.004, 65],
    'sidebar-pressed': [23.5, 0.004, 65],
    sunken: [16.5, 0.004, 65],
    well: [22.5, 0.004, 65],
    panel: [25, 0.004, 65],
    bubble: [27, 0.004, 65],
    raised: [26, 0.004, 65], // elevation gets lighter in the dark
    overlay: [29, 0.004, 65],
    chip: [31, 0.004, 65],
    control: [28.5, 0.004, 65],
    'control-hover': [32, 0.004, 65],
    'control-pressed': [35, 0.004, 65],
    hover: [32, 0.004, 65],
    pressed: [35, 0.004, 65],
    inverse: [88, 0.004, 75],
    'on-inverse': [20.5, 0.004, 65],
    tooltip: [38, 0.004, 65],
    'on-tooltip': [93, 0.004, 75],
    'tooltip-rule': [50, 0.004, 65],
    thumb: [76, 0.005, 70],
    'on-thumb': [20.5, 0.004, 65],
    ink: [91, 0.004, 75],
    'ink-2': [84.5, 0.005, 72],
    'ink-3': [76, 0.006, 70],
    'ink-disabled': [50, 0.004, 65],
    'rule-subtle': [36, 0.004, 65],
    rule: [42, 0.004, 65],
    'rule-strong': [59, 0.004, 65],
    focus: [82, 0.135, 74],
    'on-fill-dark': [19, 0.02, 60],
    'on-fill-light': [97, 0.006, 75],
  },
};

// The video viewer surround is the same near-neutral grey in both themes, so footage colour reads true; text and
// marks drawn on it take the viewer's own inks, the same in both themes.
export const constants = {
  viewer: [22, 0.002, 65],
  'viewer-rule': [32, 0.002, 65],
  'viewer-ink': [94, 0.002, 65],
  'viewer-ink-2': [80, 0.002, 65],
};

// Four accents, each with a job. Every accent has four tokens per theme:
//   fill    a bright tone for filled controls and brand moments (text on it: -ink)
//   strong  for accent text, icons, thin markers and borders on any surface
//   soft    a tinted wash for chips, selected rows and badges
//   ink     generated: whichever on-fill text colour contrasts more
export const accents = {
  marigold: {
    job: 'Primary action, focus, selection, playhead, progress, the Make area, beat one of the logo',
    // UX4: light strong one step deeper (53 → 52), so it holds 4.5:1 on a hovered row; the logo keeps 53.
    light: { fill: [80, 0.155, 72], strong: [52, 0.137, 50], soft: [94.5, 0.04, 80] },
    dark: { fill: [80, 0.15, 70], strong: [84, 0.135, 76], soft: [29.5, 0.055, 68] },
  },
  rose: {
    job: 'Templates area, beat markers, slot boundaries, the rhythm of a reference',
    light: { fill: [64, 0.19, 5], strong: [51, 0.17, 6], soft: [95, 0.025, 5] },
    // UX4: dark strong lifted (77 → 81) to APCA Lc 60 on every surface and its wash.
    dark: { fill: [70, 0.17, 5], strong: [81, 0.112, 5], soft: [29.5, 0.055, 5] },
  },
  teal: {
    job: 'Library area, your footage, and everything you changed (the "you" marker)',
    light: { fill: [72, 0.115, 185], strong: [47, 0.08, 190], soft: [94.5, 0.03, 185] },
    dark: { fill: [74, 0.115, 185], strong: [80, 0.1, 185], soft: [29.5, 0.04, 185] },
  },
  violet: {
    job: 'Agent area, AI activity, and everything the agent decided (the "AI" marker)',
    light: { fill: [56, 0.17, 290], strong: [49, 0.17, 290], soft: [95, 0.025, 290] },
    // Dark soft re-tuned in DESIGN.md v0.2 (A4) for chip-sized use: less chroma, so no violet slabs.
    dark: { fill: [70, 0.15, 290], strong: [80.5, 0.104, 290], soft: [29.5, 0.045, 290] },
  },
};

// UX4: every dark -soft wash sits at lightness 29.5, so a chip reads on a card (raised 26) as well as on the canvas.

// Kinds (v0.6, UX3): four category hues for what a thing is, never for where you are or who did it. Each sits in a
// gap between the accents' and the statuses' hues (coral between vermilion and marigold, lime between yellow and
// green, sky between teal and blue, orchid between violet and rose), always with an icon or a word beside it, and the
// same four tones as an accent. Components use their meaning roles below (format families, slot roles, fit).
export const kinds = {
  sky: {
    job: 'Story formats (vlog, day in the life), a slot that ends a video, and what is new',
    light: { fill: [72, 0.11, 225], strong: [48, 0.1, 235], soft: [95, 0.025, 225] },
    dark: { fill: [74, 0.11, 225], strong: [80, 0.095, 225], soft: [29.5, 0.045, 225] },
  },
  lime: {
    job: 'Reveal formats (before and after, highlight reel) and how well a template fits your clips',
    light: { fill: [80, 0.15, 125], strong: [47, 0.11, 130], soft: [95, 0.045, 125] },
    dark: { fill: [80, 0.15, 125], strong: [84, 0.13, 125], soft: [29.5, 0.05, 125] },
  },
  coral: {
    job: 'Show-how formats (product ad, how-to) and the hook, the slot that opens a video',
    light: { fill: [72, 0.15, 45], strong: [52, 0.15, 40], soft: [94.8, 0.026, 48] },
    dark: { fill: [74, 0.14, 45], strong: [81, 0.105, 45], soft: [29.5, 0.055, 45] },
  },
  orchid: {
    job: 'Voice formats (talking to camera, podcast clip) and the peak, the slot a video builds to',
    light: { fill: [66, 0.17, 330], strong: [50, 0.17, 330], soft: [95, 0.03, 330] },
    dark: { fill: [72, 0.15, 330], strong: [81, 0.105, 330], soft: [29.5, 0.055, 330] },
  },
};

// Status colours. Always paired with an icon and a word, never colour alone.
// Hues sit away from the accents: warning is yellow (not marigold), danger is
// vermilion (not rose), success is green (not teal), info is blue (not violet).
export const status = {
  success: {
    light: { fill: [62, 0.15, 150], strong: [46, 0.11, 150], soft: [94.5, 0.04, 150] },
    dark: { fill: [74, 0.15, 150], strong: [80, 0.13, 150], soft: [29.5, 0.05, 150] },
  },
  warning: {
    light: { fill: [86, 0.155, 95], strong: [50, 0.1, 78], soft: [95.5, 0.05, 95] },
    dark: { fill: [86, 0.15, 95], strong: [88, 0.13, 95], soft: [29.5, 0.05, 95] },
  },
  danger: {
    light: { fill: [57, 0.2, 28], strong: [50, 0.18, 28], soft: [95, 0.025, 28] },
    // UX4: dark fill is the light theme's red (white words on it, Lc 72), not a coral with dark words (Lc 46).
    dark: { fill: [56, 0.2, 28], strong: [81, 0.106, 28], soft: [29.5, 0.065, 28] },
  },
  info: {
    light: { fill: [60, 0.12, 245], strong: [47, 0.1, 245], soft: [95, 0.025, 245] },
    dark: { fill: [72, 0.12, 245], strong: [79, 0.1, 245], soft: [29.5, 0.05, 245] },
  },
};

// The logo's four beats (clockwise from the top) and its wordmark, per theme. Light uses the
// strong accents so every arc holds 5:1 on paper; dark uses the fills. See design/logo/kit.
// The wordmark keeps the kit's own ink and cream (#1e1712, #f0ece7), and beat one its burnt orange (#a94e00), as
// values, so the logo stays the logo when the reading tones move (UX4 lowered the dark ink and deepened marigold-strong).
export const logo = {
  light: { 1: [53, 0.14, 50], 2: 'rose-strong', 3: 'violet-strong', 4: 'teal-strong', ink: [21, 0.014, 55] },
  dark: { 1: 'marigold', 2: 'rose', 3: 'violet', 4: 'teal', ink: [94.5, 0.008, 78] },
};

// The window's traffic controls (DESIGN.md, "Window"). Tuned to the macOS hues for now, so
// the controls read as the Mac's own: close, minimise, zoom, each with the dark glyph ink
// drawn on it, and the neutral grey the discs turn when the window is not the active one.
// Each value is an [L, C, H] or the name of another colour token: to move the controls onto
// Taalcut's palette, point them at it ({ close: 'danger', 'close-ink': 'danger-ink', … }).
export const windowControls = {
  light: {
    close: [69.4, 0.196, 26.4],
    'close-ink': [26.4, 0.108, 29.2],
    minimize: [83.5, 0.161, 80.9],
    'minimize-ink': [52.2, 0.12, 62.4],
    zoom: [72.8, 0.217, 144.7],
    'zoom-ink': [43.9, 0.149, 142.5],
    inactive: [88.5, 0.004, 75],
  },
  dark: {
    close: [69.4, 0.196, 26.4],
    'close-ink': [26.4, 0.108, 29.2],
    minimize: [83.5, 0.161, 80.9],
    'minimize-ink': [52.2, 0.12, 62.4],
    zoom: [72.8, 0.217, 144.7],
    'zoom-ink': [43.9, 0.149, 142.5],
    inactive: [42, 0.004, 65],
  },
};

// Meaning layer: what the product talks about, mapped onto the palette.
// These are theme-independent references, so they follow light and dark for free.
export const roles = {
  primary: 'marigold',
  'area-make': 'marigold',
  'area-templates': 'rose',
  'area-library': 'teal',
  'area-agent': 'violet',
  ai: 'violet',
  you: 'teal',
  beat: 'rose',
  playhead: 'marigold',
  // Kinds (v0.6, UX3): a format's family, a slot's role, how well a template fits, what is new.
  'format-story': 'sky',
  'format-voice': 'orchid',
  'format-show': 'coral',
  'format-reveal': 'lime',
  'slot-hook': 'coral',
  'slot-peak': 'orchid',
  'slot-outro': 'sky',
  fit: 'lime',
  new: 'sky',
};

// 2xs and xs (v0.4, UX1) are the faintest lifts: a field, a switch, a selected tile. Components used them
// before they existed, when they drew nothing; they stay below sm so a hairline still does the work.
export const shadows = {
  light: {
    '2xs': '0 1px 0 oklch(30% 0.03 60 / 0.05)',
    xs: '0 1px 1px oklch(30% 0.03 60 / 0.06)',
    sm: '0 1px 2px oklch(30% 0.03 60 / 0.08)',
    md: '0 1px 2px oklch(30% 0.03 60 / 0.06), 0 8px 24px oklch(30% 0.03 60 / 0.08)',
    lg: '0 2px 6px oklch(30% 0.03 60 / 0.08), 0 24px 56px oklch(30% 0.03 60 / 0.16)',
  },
  dark: {
    '2xs': '0 1px 0 oklch(6% 0.01 60 / 0.3)',
    xs: '0 1px 1px oklch(6% 0.01 60 / 0.4)',
    sm: '0 1px 2px oklch(6% 0.01 60 / 0.5)',
    md: 'inset 0 1px 0 oklch(95% 0.01 75 / 0.04), 0 8px 24px oklch(6% 0.01 60 / 0.45)',
    lg: 'inset 0 1px 0 oklch(95% 0.01 75 / 0.05), 0 24px 64px oklch(6% 0.01 60 / 0.6)',
  },
};

export const scrim = {
  light: 'oklch(22% 0.02 60 / 0.38)',
  dark: 'oklch(6% 0.01 60 / 0.62)',
};

// Body text keeps its weight in dark. With antialiased smoothing, light text on a dark canvas reads thinner, not
// heavier, so trimming it (UX1-UX3 set 380) made dense dark pages look faint. Chosen on /dev/type for Onest (UX4).
export const bodyWeight = { light: 400, dark: 400 };

// Noto families after the UI face, one per script, so people's own words (clip names, transcripts, captions, chat)
// never show a missing-glyph box. Each loads only when its script is on screen (unicode-range), at 98.3% so its
// x-height meets Onest's (apps/renderer/src/fonts/fonts.css). CJK falls back to the system's own fonts.
const SCRIPT_FALLBACKS = [
  'Noto Sans Devanagari',
  'Noto Sans Bengali',
  'Noto Sans Gujarati',
  'Noto Sans Gurmukhi',
  'Noto Sans Kannada',
  'Noto Sans Malayalam',
  'Noto Sans Oriya',
  'Noto Sans Tamil',
  'Noto Sans Telugu',
]
  .map((family) => `"${family} Variable"`)
  .join(', ');

export const fonts = {
  // One family for everything the user reads (UX4): Onest, which covers Latin, Latin Extended, Cyrillic and
  // Vietnamese. Noto Sans fills in Greek and anything Onest lacks; then the Indian scripts, Arabic, Hebrew, Thai.
  sans: `"Onest Variable", "Noto Sans Variable", ${SCRIPT_FALLBACKS}, "Noto Sans Arabic Variable", "Noto Sans Hebrew Variable", "Noto Sans Thai Variable", system-ui, ui-sans-serif, sans-serif`,
  // Timecodes, frame counts, durations, file sizes: numbers that change in place. Their units and Intl's words
  // beside them can be in an Indian language (<time> is set in mono), so the Indian scripts back the glyphs
  // JetBrains Mono doesn't have; Latin text is unchanged.
  mono: `"JetBrains Mono Variable", ${SCRIPT_FALLBACKS}, ui-monospace, "SF Mono", Menlo, monospace`,
};

// App type scale (UX4, tuned for Onest). Dense steps (11–15 px) move by 1 px for UI; from 17 px up the scale
// follows a 1.2 ratio. Onest is open and wide, so small sizes get a touch of air and large ones close up.
// The type roles in roles.css pick from these; reach for a role, not a size. [rem, line-height, letter-spacing]
export const text = {
  '2xs': ['0.6875rem', '1rem', '0.01em'], // 11 caption: chips and timeline labels only
  xs: ['0.75rem', '1rem', '0.005em'], // 12 meta: counts, dates, sizes, hints
  sm: ['0.8125rem', '1.25rem', '0'], // 13 small controls (type-label-sm); older dense lists
  base: ['0.875rem', '1.375rem', '0'], // 14 body, labels, data: the default UI size
  md: ['0.9375rem', '1.5rem', '-0.002em'], // 15 card titles and prose
  lg: ['1.0625rem', '1.5rem', '-0.008em'], // 17 section headings
  xl: ['1.25rem', '1.75rem', '-0.014em'], // 20 the page title
  '2xl': ['1.5rem', '2rem', '-0.018em'], // 24 large titles
  '3xl': ['1.8125rem', '2.25rem', '-0.022em'], // 29 headlines: first run, empty states
  '4xl': ['2.1875rem', '2.625rem', '-0.026em'], // 35 empty-state headlines
  display: ['clamp(2.5rem, 2vw + 1.75rem, 3.25rem)', '1.1', '-0.03em'], // 40–52 brand moments only
};

export const weights = { light: 300, regular: 400, medium: 500, semibold: 600, bold: 700 };

// 4-pt spacing scale.
export const space = {
  '3xs': '0.125rem', // 2
  '2xs': '0.25rem', // 4
  xs: '0.5rem', // 8
  sm: '0.75rem', // 12
  md: '1rem', // 16
  lg: '1.5rem', // 24
  xl: '2rem', // 32
  '2xl': '3rem', // 48
  '3xl': '4rem', // 64
  '4xl': '6rem', // 96
};

// --radius matches shadcn/ui's base; the named steps line up with its sm/md/lg/xl.
export const radius = {
  base: '0.625rem', // 10
  clip: '0.25rem', // 4  timeline clips and beat chips
  sm: '0.375rem', // 6  badges, small chips
  md: '0.5rem', // 8  buttons, inputs
  lg: '0.625rem', // 10 cards
  xl: '0.875rem', // 14 panels, smart cards in chat
  '2xl': '1.25rem', // 20 dialogs, the composer
  pill: '999px', // segmented controls, tags
};

export const motion = {
  ease: {
    out: 'cubic-bezier(0.16, 1, 0.3, 1)', // entering
    in: 'cubic-bezier(0.7, 0, 0.84, 0)', // leaving
    'in-out': 'cubic-bezier(0.65, 0, 0.35, 1)', // state toggles
  },
  dur: { micro: '120ms', short: '220ms', long: '420ms' },
};

// Contrast floors the build enforces (WCAG 2.x ratios). The APCA floors and the dark separation floors sit with the
// gate, in design/scripts/contrast-gate.mjs.
export const floors = { body: 4.5, strongText: 7, ui: 3 };
