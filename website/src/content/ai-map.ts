// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * /ai/ · lane M's own short labels: the map of what leaves your computer (Profiles and Local only), the memory meter
 * (On your computer) and the page head's art. They name places and parts only. Every fact these surfaces show is
 * providers.ts's, word for word (PROFILES, LOCAL_ONLY, ON_DEVICE, AI_STICKERS); each label below says where its words
 * come from. test/unit/ai-map.test.ts holds them to those sources.
 */

/** The map's two territories, the footage in yours, and the lanes' own words. */
export const AI_MAP = {
  /** LOCAL_ONLY says "leaves your computer" and "on your computer" throughout. */
  computer: 'Your computer',
  /** LOCAL_ONLY.leavesWhenOff[0]: "Cloud models you chose". */
  cloud: 'The AI you chose',
  /** PROVIDERS' on-device entry: "Taalcut’s own models" do the always-local jobs. */
  models: 'Taalcut’s own models',
  /** ON_DEVICE.facts[0]: "Search, text in video and music beats", a chip each. */
  jobs: ['Search', 'Text in video', 'Music beats'],
  /** LOCAL_ONLY.stillRuns opens "Update checks still send …": the lane that crosses in every state. */
  updates: 'Update checks',
  /** A lane's state in words, beside its drawing: LOCAL_ONLY.whatLeaves ("What leaves your computer"). */
  leaves: 'Leaves your computer',
  stays: 'Stays on your computer',
  /** The zone past the border: LOCAL_ONLY says what "leaves your computer"; the app's words don't say where to. */
  outside: 'Outside your computer',
  /** The objects' slow trip is motion that runs on, so it has its own control (WCAG 2.2.2). */
  pause: 'Pause the map',
  play: 'Play the map',
} as const;

/**
 * The words on the crossing objects, each a short form of its LOCAL_ONLY fact, whose full words caption it. The
 * agent's message and tool result are the agent page's own (components/showcase/agent/run-script.ts).
 */
export const AI_MAP_OBJECTS = {
  /** LOCAL_ONLY.leavesWhenOff[1]: "Taalcut downloads a reel you paste". */
  link: 'A reel you paste',
  /** LOCAL_ONLY.leavesWhenOff[2]: "only if you add an ElevenLabs key and allow it". */
  speech: 'ElevenLabs',
  /** LOCAL_ONLY.leavesWhenOff[3]: "Only when you turn them on. Both start off." */
  reports: 'Off until you turn them on',
  /** LOCAL_ONLY.stillRuns: "the app’s version and a random ID". */
  updates: 'The app’s version and a random ID',
} as const;

/** The computers the meter offers, each tied to the ON_DEVICE facts that name it. */
export const AI_DEVICES = [
  /** ON_DEVICE.facts[5], "8 GB Macs". */
  { id: 'mac-8', name: '8 GB Mac', brand: 'apple', memory: 8 },
  /** ON_DEVICE.facts[2], "computers with 16 GB of memory or more" (a Mac is one). */
  { id: 'mac-16', name: '16 GB Mac', brand: 'apple', memory: 16 },
  /** ON_DEVICE.facts[4], "Apple silicon Macs with 32 GB of memory and a GPU with 16 or more cores". */
  { id: 'mac-32', name: '32 GB Mac', brand: 'apple', memory: 32 },
  /** ON_DEVICE.facts[3] (a graphics card with 8 GB of video memory) and facts[2] (16 GB of memory or more). */
  { id: 'ubuntu', name: 'Ubuntu', brand: 'ubuntu', memory: 16 },
] as const;

/** The meter's own words. */
export const AI_METER = {
  /** ON_DEVICE.facts[2] and [4] say "memory"; facts[3] "video memory"; facts[4] "a GPU with 16 or more cores". */
  memory: 'Memory',
  videoMemory: 'Video memory',
  gpu: 'GPU cores',
  /** ON_DEVICE.facts[2]: "16 GB of memory or more"; facts[4]: "16 or more cores". */
  orMore: 'or more',
  /** The scale's marks, in the facts' units. */
  marks: ['8 GB', '16 GB', '32 GB'],
  /** The computer picker's name (ON_DEVICE.heading's "your computer"). */
  pick: 'Your computer',
  /** ON_DEVICE.facts[1]'s label is "Speech"; the chip says it the same. */
  speech: 'Speech',
  /** ON_DEVICE.facts[5]: "Understanding images needs a cloud model." */
  images: 'Understanding images',
  replay: 'Fill the meter again',
} as const;

/** The head's art: the reel the AI cuts (#content/reels' "Vietnam, on repeat", the version Taalcut made). */
export const AI_HEAD = {
  reel: 'repeat',
  /** What the video shows, for assistive technology; the reel's own title follows. */
  label: (title: string) => `A reel Taalcut cut from your own footage: ${title}`,
} as const;
