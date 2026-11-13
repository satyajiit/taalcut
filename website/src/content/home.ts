// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The home page's words below the hero (lane L2): the two problems, Paste, pick, approve, the feature tour, the
 * starter formats, your AI, privacy, platforms, Kaatu and the questions. Every line is in the truth ledger
 * (_orch/web1/fix-1-ledger.md); test/unit/home-content.test.ts runs them all through the claims ledger and the hedge
 * sweep. Words other pages share stay in their own files (features, providers, platforms, faq).
 */
import { CAMERA_ROLL } from './reels';

/** 1,284: the camera roll the demos show. */
const ROLL_COUNT = CAMERA_ROLL.shownCount.toLocaleString('en-US');

/**
 * The launch film (2026-11-07), under the hero: "Zero posts", 1:41, on the Matterward Labs YouTube channel. It plays from
 * YouTube's privacy-enhanced host, and nothing loads from YouTube until the visitor presses play (privacy › The launch
 * film). The poster is composed launch artwork using the film's footage (public/media/film/).
 */
export const FILM_SECTION = {
  id: 'film',
  heading: 'The launch film',
  lead: 'Ten days in Vietnam, one saved reel, and no evening to copy it. Then Taalcut.',
  play: 'Play the launch film',
  playShort: 'Play',
  length: '1:41',
  youtubeId: 'w3PZrIf9CGY',
  watch: 'Watch on YouTube',
  note: 'It plays from YouTube. Nothing loads from YouTube until you press play.',
  frameTitle: 'Taalcut launch film',
  poster: {
    large: '/media/film/zero-posts-collage-v1-1920.webp',
    small: '/media/film/zero-posts-collage-v1-960.webp',
  },
} as const;

export const ROLL_PROBLEM = {
  id: 'problem-roll',
  heading: 'Too many clips to pick from',
  lead: 'The shot you need is in your camera roll somewhere. Scrolling for it takes longer than the reel lasts.',
  facts: [
    'Taalcut indexes your clips on your computer.',
    'Each slot of the reel says what it needs.',
    'The AI picks a clip for each one and shows how sure it is.',
  ],
  window: {
    title: 'Library',
    roll: 'Camera roll',
    count: `${ROLL_COUNT} clips`,
    sort: 'Newest first',
    found: 'AI picked 13 clips for 13 slots',
  },
  sticker: `${ROLL_COUNT} clips`,
  picked: '13 picked',
  pickChip: 'AI pick',
} as const;

export const SAVED_PROBLEM = {
  id: 'problem-saved',
  heading: 'The reel you saved and never made',
  lead: 'You saved it to make one like it. Copying its cuts and timing by hand takes an evening you don’t have, so it stays saved.',
  turn: 'Paste it into Taalcut and it becomes a template you can fill with your clips.',
  saved: 'Saved',
  stickers: { beats: '22 music beats', slots: '13 slots' },
  label: 'A saved reel: Vietnam, walking away on every beat',
} as const;

export const HOW = {
  heading: 'Paste, pick, approve',
  lead: 'One pass from a reel you saved to your version. Tap through it like a story.',
  steps: [
    {
      id: 'paste',
      title: 'Paste',
      line: 'Paste a reel or drop the video in. Taalcut reads its cuts, music beats, on-screen text, transitions and pacing.',
      reads: ['Cuts', 'Music beats', 'On-screen text', 'Transitions', 'Pacing'],
    },
    {
      id: 'pick',
      title: 'Pick',
      line: 'Each slot says what it wants. The AI picks a clip from your camera roll, shows how sure it is and keeps up to 3 other shots.',
      reads: [],
    },
    {
      id: 'approve',
      title: 'Approve',
      line: 'The agent checks the cut against the reel. You watch your version and approve once. Undo covers every edit.',
      reads: ['Checked against the reel', 'Watch it', 'Approve once'],
    },
  ],
  controls: { previous: 'Previous step', next: 'Next step', pause: 'Pause the steps', play: 'Play the steps' },
  stepButton: (n: number, title: string) => `Step ${n}: ${title}`,
  picked: (n: number, of: number) => `${n} of ${of} slots picked`,
  others: '+3 other shots',
  approve: 'Approve',
  approved: 'Approved',
  undo: 'Undo covers every edit',
  version: 'Your version',
} as const;

/** How sure the AI is, in the app's own three words (packages/ui make/confidence.tsx). */
export const SURE = { high: 'High', medium: 'Medium', low: 'Low' } as const;
export type Sure = keyof typeof SURE;

export const TOUR = {
  heading: 'Watch every part work',
  lead: 'The five parts of making it like the reel you saved, each running on a real reel and its footage.',
  all: 'All features',
  /** Per feature page, in FEATURES' order: the row's one line and its link's words. */
  rows: {
    'reel-breakdown': {
      line: 'Paste a link or drop a file. It finds the cuts and music beats, and you can fix a cut before it’s used.',
      more: 'More on reel breakdown',
      also: 'It also reads on-screen text, transitions, speed ramps and pacing.',
    },
    'auto-pick': {
      line: 'Search your clips in plain words. Each slot gets the clip that fits, with how sure the AI is.',
      more: 'More on auto-pick',
      also: 'Phone clips come over Wi-Fi with a QR code, or folders are read in place.',
    },
    templates: {
      line: 'The reel you saved becomes a template you keep. Fill it with this weekend’s trip, then next month’s.',
      more: 'More on templates',
      also: 'A template keeps the slots, the music beats, the text and its timing.',
    },
    agent: {
      line: 'Say what you want in a sentence. The agent cuts, checks its work against the reel and asks you to approve once.',
      more: 'More on the agent',
      also: 'Choose how hard it thinks from the chat box. Undo covers every edit, the agent’s included.',
    },
    editor: {
      line: 'The agent’s work sits on a timeline. Swap, move or slip a clip and it’s marked as yours.',
      more: 'More on the editor',
      also: 'Captions word by word, and as an SRT file. MP4 in H.264 or HEVC.',
    },
  },
  breakdown: { title: 'Reel breakdown', cuts: 'Cuts', beats: 'Music beats', slots: 'Slots', found: '12 cuts · 22 music beats', fix: 'Fix a cut' },
  pick: {
    title: 'Search',
    query: 'walking away at night',
    found: '4 clips match',
    slot: 'Slot 7 · Build',
  },
  template: {
    title: 'Templates',
    saved: 'Saved as a template',
    name: 'Walking away on every beat',
    meta: '13 slots · 22 music beats',
    fills: ['Vietnam trip', 'This weekend', 'Next month'],
    fill: 'Fill it again',
  },
  agent: {
    title: 'Agent',
    ask: 'Make this reel with my Vietnam clips.',
    who: 'Taalcut',
    steps: ['Read the reel: 12 cuts, 22 music beats', 'Picked 13 clips from your camera roll', 'Checked the cut against the reel'],
    ready: 'Your version is ready',
    approve: 'Approve',
    undo: 'Undo',
    composer: 'Ask for a change',
  },
  editor: {
    title: 'Editor',
    tracks: { video: 'Video', music: 'Music', captions: 'Captions' },
    words: ['How’s', 'Vietnam?', 'Well…'],
    yours: 'You changed this',
    export: 'Export',
    formats: 'MP4 · SRT captions',
  },
  replay: 'Play again',
} as const;

/**
 * More ways to make (WEB3): the six features beyond the reel pass, after the tour. Each row's one line and the words its
 * small drawing shows, in the app's own labels (Library › Import, Make a short, Trending sounds & hooks, Create ›
 * Product launch, Products, Settings › Plugins and External agents). Every fact is in SPEC.md's WEB3 truth ledger.
 */
export const MORE_WAYS = {
  id: 'more-ways',
  heading: 'More ways to make',
  lead: 'Six more parts of the same app: footage from anywhere, shorts from long videos, sounds trending in Edits, videos for what you build, and plugins for the tools you use.',
  all: 'All eleven features',
  rows: {
    import: {
      line: 'Scan a code to send clips from your phone over Wi-Fi, or bring in files and folders. Every copy is checked, then indexed on your computer.',
      place: 'Library › Import',
      everywhere: ['Phone over Wi-Fi', 'Files', 'Folder'],
      mac: 'On a Mac',
      macWays: ['Phone on a cable', 'Camera or card', 'DJI', 'Insta360', 'Apple Photos'],
      phone: 'Same Wi-Fi',
      files: ['IMG_2041.MOV', 'IMG_2044.MOV', 'IMG_2047.MOV'],
      stages: ['Searchable', 'Available to edit', 'Checking the copy'],
    },
    shorts: {
      line: 'Choose a long video and a length. Taalcut keeps whole sentences and scenes, a hook, the context and the payoff, and adds captions.',
      place: 'Make a short',
      source: 'YouTube video link',
      video: 'Airport day, the full vlog',
      duration: '24:18',
      lengths: ['30 s', '60 s', '90 s'],
      parts: ['Hook', 'Context', 'Payoff'],
      caption: ['We', 'made', 'the', 'flight'],
      short: 'Your short',
      runs: '0:54',
    },
    'instagram-edits': {
      line: 'With Edits open on your Mac, browse what’s trending, see where each hook drops, and cut your next video on its beat.',
      place: 'Trending sounds & hooks',
      live: 'Instagram Edits live',
      tabs: ['Trending', 'For You', 'Saved'],
      sounds: [
        { title: 'Boarding call', hook: 7 },
        { title: 'Night market walk', hook: 12 },
        { title: 'Window seat', hook: 4 },
      ],
      artist: 'Original audio',
      hook: (s: number) => `Hook ${s} s`,
      cut: 'Cut with AI',
    },
    'launch-videos': {
      line: 'Write a brief and add your product’s website or project folder. Approve the script and the look, and the video opens in the editor.',
      place: 'Create › Product launch',
      idea: 'Your video idea',
      brief: 'Launch phone import: scan a code, clips arrive, start editing.',
      scene: (n: number) => `Scene ${n}`,
      scenes: ['Scan the code', 'Clips arrive', 'Ready to edit'],
      formats: ['Landscape', 'Portrait', 'Square', '4:5'],
      approve: 'Approve script & design',
    },
    'product-videos': {
      line: 'Save your product and its sources once. Taalcut finds a video idea per feature, backed by lines from your sources, and posts only after you approve.',
      place: 'Products › Taalcut',
      find: 'Find video ideas',
      sources: ['taalcut.app', 'Project folder'],
      /** The ideas: one of Taalcut's own features each, backed by a sentence of its summary on this site (#content/features). */
      ideas: [
        { slug: 'shorts', sentence: 1 },
        { slug: 'import', sentence: 0 },
        { slug: 'reel-breakdown', sentence: 1 },
      ],
      schedule: 'Research on a schedule',
      approval: 'Posts wait for your approval',
    },
    plugins: {
      line: 'Connect Postiz to post and Instagram Edits for sounds. Let Claude Code or Codex on your Mac work in Taalcut, as you allow.',
      place: 'Settings › Plugins',
      list: 'Plugins',
      plugins: [
        { name: 'Postiz', does: 'Schedule and post after you approve' },
        { name: 'Instagram Edits', does: 'Trending sounds, staged videos' },
      ],
      agents: 'External agents',
      agentRows: [
        { name: 'Claude Code', level: 'Edit' },
        { name: 'Codex', level: 'Read' },
      ],
      levels: ['Read', 'Edit', 'Export'],
      ask: 'Exports and deletes still ask you',
    },
  },
} as const;

export const STARTERS_SECTION = {
  heading: 'Start from a format',
  lead: '8 starter templates in your language, 14 in all. Tap one to play its shape.',
  previous: 'Show earlier formats',
  next: 'Show more formats',
  region: 'Starter templates',
  slots: (n: number) => `${n} slots`,
  seconds: (n: number) => `${n} s`,
  play: (name: string) => `Play the shape of ${name}`,
} as const;

export const YOUR_AI_SECTION = {
  heading: 'Use the AI you already pay for',
  lead: 'Continue with ChatGPT and Taalcut works on your plan. Or bring an API key, run models on your computer, or use your own server.',
  chatgpt: { name: 'ChatGPT', button: 'Continue with ChatGPT', line: 'Bills your ChatGPT plan, with no second bill from Taalcut' },
  keys: { heading: 'Your API key' },
  server: { heading: 'Your own server' },
  device: {
    heading: 'On your computer',
    line: 'Search, text in video and music beats always run here. Speech and the agent can too.',
    foot: 'Taalcut’s own models, nothing to install',
  },
  local: {
    label: 'Local only',
    line: 'Keep everything on this computer',
    on: 'Nothing of yours leaves your computer. Update checks still send the app’s version and a random ID.',
    off: 'The AIs you choose get what a job sends them. Taalcut asks before it first sends your files to a cloud model.',
    paused: 'Off while Local only is on',
  },
  link: 'Bring your own AI',
} as const;

export const PRIVATE_SECTION = {
  heading: 'Private by default',
  lead: 'Your clips stay on your computer. Taalcut indexes and searches them there, with no upload and no storage cap.',
  facts: [
    'Indexing and search run on your computer.',
    'No upload and no storage cap.',
    'Taalcut asks before it first sends your files to a cloud model.',
    'API keys are kept encrypted with a key in your computer’s keychain.',
    'With Local only on, nothing of yours leaves your computer.',
    'Update checks still send the app’s version and a random ID.',
  ],
  window: { title: 'Library', place: 'On this computer', indexed: 'Indexed here', clips: `${ROLL_COUNT} clips` },
  lock: 'Stays on your computer',
  link: 'Privacy questions',
} as const;

export const PLATFORMS_SECTION = {
  heading: 'Made for Apple silicon. On Ubuntu too.',
  lead: 'One app for your computer. Join the waitlist and you get the beta for yours when it opens.',
  link: 'Platforms and requirements',
  names: { macos: 'macOS', ubuntu: 'Ubuntu 24.04', windows: 'Windows' },
  needs: {
    macos: 'macOS 14 or later, Apple silicon (M1 or later)',
    ubuntu: 'x64. Drop a reel in as a file for now',
    windows: 'Comes after 1.0',
  },
} as const;

export const KAATU_SECTION = {
  heading: 'Meet Kaatu',
  name: 'Kaatu',
  named: 'is named from',
  word: 'काटना',
  meaning: '“to cut”',
  lead: 'Taalcut’s beaver keeps you company in the app. Beavers cut, and so does Taalcut.',
  poke: 'Poke Kaatu',
  hint: 'Tap Kaatu for a laugh. Press Poke Kaatu for its next trick, or a photo for that one.',
  tricks: ['Waves hello', 'Thinks it over', 'Cheers you on', 'Bops to the beat', 'Snips a clip', 'Dozes off', 'Calls action'],
  poses: { headphones: 'On the beat', snip: 'Snip', film: 'Action' },
} as const;

export const FAQ_TEASER = {
  heading: 'Questions',
  ids: ['which-reels', 'do-i-edit', 'footage-leaves'],
  all: 'All questions',
} as const;
