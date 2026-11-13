// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { Fact } from './schema';
import { SITE } from './site';

/**
 * The press kit (lane L6). Sources: NAMING.md, design/logo/README.md and kit/README.md (the logo and its rules),
 * DESIGN.md › Kaatu (the mascot's rules) and the kit's files, which scripts/brand-assets.mjs copies to /brand/. No
 * coverage, quotes or numbers: only what a writer needs to describe Taalcut and show its marks.
 */

/** A file in the press kit, served from /brand/. */
export interface PressFile {
  readonly label: string;
  readonly href: string;
  readonly format: string;
}

/** One logo drawing, shown on the ground it is made for, with its file. */
export interface PressLogo {
  readonly label: string;
  readonly href: string;
  /** The ground it is drawn for: the preview sits on it in both themes. */
  readonly ground: 'light' | 'dark';
}

/** One of Kaatu's drawings, cut from the app's atlases (components/kaatu/kaatu-frames.ts), as a PNG sticker. */
export interface PressKaatu {
  /** The frame's name in the atlases. */
  readonly frame: 'wave' | 'clapper' | 'clap' | 'bop-left' | 'chomp' | 'heart' | 'starstruck' | 'peekaboo' | 'curious' | 'laugh' | 'wink' | 'sleepy';
  /** What the drawing shows, in words: the sticker's name and its file's. */
  readonly name: string;
}

export const PRESS = {
  oneLiner: 'Taalcut turns a reel you love into a template, then makes your version from your own camera roll.',
  /** The descriptions a writer can copy, shortest first. */
  descriptions: [
    { id: 'short', label: 'In five words', text: 'Make the reel you saved.' },
    { id: 'line', label: 'In one line', text: 'Taalcut turns a reel you love into a template, then makes your version from your own camera roll.' },
    { id: 'para', label: 'In a paragraph', text: `${SITE.description} ${SITE.story}` },
  ],
  stickers: { logos: 'Logos in SVG', kaatu: 'Kaatu stickers', colours: 'Four colours' },
  facts: [
    ['Name', 'Taalcut. Never TaalCut or Taal Cut.'],
    ['Say it', SITE.pronunciation],
    ['What it is', 'An AI video editor for short videos that runs on your computer'],
    ['Made by', `[${SITE.company.legal}](${SITE.company.url})`],
    ['Platforms', 'macOS on Apple silicon and Ubuntu 24.04. Windows comes after 1.0.'],
    ['Price', 'Free. Taalcut doesn’t run AI for you or keep your files.'],
    ['Licence', `${SITE.licence.name}. The code opens with the beta.`],
    ['Status', 'A private build. The beta opens to the waitlist first.'],
    ['Instagram', SITE.instagram.handle],
  ] satisfies readonly Fact[],
  logos: [
    { label: 'Four colours, for light backgrounds', href: '/brand/taalcut-horizontal-four-colour-light.svg', ground: 'light' },
    { label: 'Four colours, for dark backgrounds', href: '/brand/taalcut-horizontal-four-colour-dark.svg', ground: 'dark' },
    { label: 'Two colours, for light backgrounds', href: '/brand/taalcut-horizontal-two-colour-light.svg', ground: 'light' },
    { label: 'Two colours, for dark backgrounds', href: '/brand/taalcut-horizontal-two-colour-dark.svg', ground: 'dark' },
  ] satisfies readonly PressLogo[],
  logoLead: 'Four colours for brand moments, two for everyday use. Each comes in a drawing for light backgrounds and one for dark.',
  logoRules: [
    'Keep a clear space of a quarter of the symbol’s width on every side. It scales with the logo.',
    'The arcs run clockwise from the top: marigold, rose, violet, teal. Never reorder or recolour them.',
    'The wordmark is drawn, not typed. Never set “taalcut” in Onest or any other font.',
    'No shadows, outlines, gradients, glows or other effects. Don’t stretch, squash or rotate it.',
    'Light versions go on light backgrounds and dark versions on dark ones.',
    'The horizontal lockup is at least 100 px wide; use the small drawing between 100 and 159 px.',
  ],
  kaatuLead: 'Kaatu is Taalcut’s mascot, a young beaver. Each drawing downloads as a 480 px PNG sticker on a clear background.',
  kaatu: [
    { frame: 'wave', name: 'Waving' },
    { frame: 'clapper', name: 'With the clapperboard' },
    { frame: 'clap', name: 'Action' },
    { frame: 'bop-left', name: 'On the beat' },
    { frame: 'chomp', name: 'Chomping' },
    { frame: 'heart', name: 'A heart' },
    { frame: 'starstruck', name: 'Starstruck' },
    { frame: 'peekaboo', name: 'Peekaboo' },
    { frame: 'curious', name: 'Curious' },
    { frame: 'laugh', name: 'Laughing' },
    { frame: 'wink', name: 'Winking' },
    { frame: 'sleepy', name: 'Asleep' },
  ] satisfies readonly PressKaatu[],
  mascotRules: [
    'Kaatu is decorative. The words beside it carry the meaning.',
    'Never over footage, never in a decision and never as the AI’s face.',
    'One Kaatu in a scene at most.',
    'Flat vector, no outlines, one soft shade per colour, with the Avartan ring as its collar.',
  ],
  coloursLead: 'The logo’s four arcs are the app’s four colours, each with one job. Each has a value for light grounds and one for dark.',
  /** The four colours in the logo's order, with the job each does (DESIGN.md › Colour). Values come from the tokens. */
  colours: [
    { token: 'logo-1', name: 'Marigold', job: 'Acts: the one button that moves you forward' },
    { token: 'logo-2', name: 'Rose', job: 'Keeps the beat: music beats and rhythm' },
    { token: 'logo-3', name: 'Violet', job: 'The AI: what it picked and decided' },
    { token: 'logo-4', name: 'Teal', job: 'You: what you chose and changed' },
  ],
  files: [
    { label: 'Avatar, 1024 × 1024', href: '/brand/avatar-1024.png', format: 'PNG' },
    { label: 'Social preview, 1280 × 640', href: '/brand/social-preview-1280x640.png', format: 'PNG' },
    { label: 'Kaatu the beaver, 1254 × 1254, transparent', href: '/brand/kaatu/kaatu-press.png', format: 'PNG' },
  ] satisfies readonly PressFile[],
  contactHeading: 'Press contact',
  contact: `For interviews, files or questions, write to [${SITE.email}](mailto:${SITE.email}).`,
} as const;
