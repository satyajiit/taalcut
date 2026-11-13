// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { Fact, Provider } from './schema';

/**
 * Bring your own AI (packages/models: signin/options.ts, registry/builtin-profiles.ts). Only sign-ins that are tested
 * appear: Claude, Copilot and Grok subscription sign-ins exist behind risk warnings in the app and stay off the site.
 */
export const PROVIDERS: readonly Provider[] = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    way: 'subscription',
    does: 'Continue with ChatGPT and use the plan you already pay for',
    markId: 'openai',
  },
  { id: 'openai', name: 'OpenAI', way: 'api-key', does: 'GPT models with your API key', markId: 'openai' },
  { id: 'anthropic', name: 'Anthropic', way: 'api-key', does: 'Claude models with your API key', markId: 'anthropic' },
  { id: 'google', name: 'Google Gemini', way: 'api-key', does: 'Gemini models with your API key', markId: 'gemini' },
  { id: 'openrouter', name: 'OpenRouter', way: 'api-key', does: 'Many models through one key', markId: 'openrouter' },
  { id: 'elevenlabs', name: 'ElevenLabs', way: 'api-key', does: 'Voice, speech and music', markId: 'elevenlabs' },
  {
    id: 'on-device',
    name: 'Taalcut’s own models',
    way: 'on-device',
    does: 'Search, text in video and music beats always run here; speech and the agent can too',
  },
  // Settings › Accounts › Servers takes these two only (packages/models settings/local-servers.ts).
  { id: 'ollama', name: 'Ollama', way: 'own-server', does: 'Your own model server, in Settings › Accounts › Servers', markId: 'ollama' },
  { id: 'lm-studio', name: 'LM Studio', way: 'own-server', does: 'Your own model server, in Settings › Accounts › Servers' },
];

/**
 * The four built-in profiles, named as Settings › Models names them, each with the app's own line, word for word
 * (apps/renderer settings/model-messages.ts: models.profile.*). The app adds nothing about which is the default, so
 * neither does the site. On Ubuntu the last one is called On this computer (models.profile.local-only.*.computer).
 */
export const PROFILES = [
  ['Fast and cheap', 'Quick, low-cost models. Good for first passes and simple edits.'],
  ['Everyday', 'Good results at a fair price. Right for most videos.'],
  ['Best quality', 'The strongest models. Slower, and each video costs more.'],
  ['On this Mac', 'Every job uses the models on this Mac. Lower quality, and no AI voice or images.'],
] as const;

/** /ai/ · the settings window: where each part lives in the app. */
export const PROFILES_DEMO = {
  heading: 'Profiles and Local only',
  lead: 'A profile sets the model for every job at once. Local only keeps everything of yours on your computer, whichever profile you picked.',
  modelsWhere: 'Settings › Models',
  privacyWhere: 'Settings › Privacy',
  profileLabel: 'Profile',
} as const;

/** How the last profile reads on Ubuntu, for the mirror (the app's .computer variants). */
export const PROFILE_ON_UBUNTU = 'On Ubuntu the last profile is called On this computer, and its line says “this computer”.';

/** /ai/ · Continue with ChatGPT (signin/chatgpt.ts; secrets through Electron safeStorage, whose key is in the OS keychain). */
export const CHATGPT = {
  heading: 'Continue with ChatGPT',
  /** The Accounts row, before and after (the app's words: Continue with ChatGPT, Using ChatGPT plan, Manage usage). */
  row: {
    button: 'Continue with ChatGPT',
    plan: 'Using ChatGPT plan',
    manage: 'Manage usage',
    signOut: 'Sign out',
    where: 'Settings › Accounts',
    picture:
      'The ChatGPT row in Settings › Accounts. Before you sign in it offers Continue with ChatGPT. After, it says Using ChatGPT plan, with Manage usage and Sign out.',
  },
  lead: 'Sign in with OpenAI and Taalcut uses the ChatGPT plan you already pay for. There is no second bill from Taalcut.',
  /** The three steps the window plays: the Accounts row, the sign-in in your browser, then the plan in use. */
  steps: [
    { id: 'accounts', label: 'Accounts', line: 'In Settings › Accounts, the ChatGPT row offers Continue with ChatGPT.' },
    { id: 'sign-in', label: 'Sign in', line: 'OpenAI’s own page opens in your browser. You sign in there, and Taalcut never sees your password.' },
    { id: 'plan', label: 'Your plan', line: 'Back in Taalcut, the row says Using ChatGPT plan, with Manage usage and Sign out.' },
  ],
  /** The window's words while it waits for the browser (the app's sign-in wait). */
  waiting: 'Waiting for your browser',
  waitingLine: 'Finish signing in on OpenAI’s page.',
  cancel: 'Cancel',
  rowLine: 'Use the ChatGPT plan you already pay for',
  /** The rows under ChatGPT in the window: the keys you could add. */
  keyRows: ['Anthropic', 'Google Gemini', 'ElevenLabs'],
  addKey: 'Add key',
  facts: [
    ['Where you sign in', 'On OpenAI’s own page, in your browser. Taalcut never sees your password.'],
    ['What it uses', 'Your ChatGPT plan and its limits. Manage usage opens OpenAI’s page for them.'],
    ['Where the sign-in lives', 'Kept encrypted with a key in your computer’s keychain. It never reaches Taalcut’s windows, its library or its logs.'],
    ['Signing out', 'One button in Settings › Accounts.'],
  ] satisfies readonly Fact[],
} as const;

/** /ai/ · the head's stickers. */
export const AI_STICKERS = { plan: 'Your ChatGPT plan', keys: 'Your API keys', local: 'On your computer' } as const;

/** /ai/ · every AI Taalcut works with, in one grid of three ways. */
export const PROVIDER_GRID = {
  heading: 'The AI it works with',
  lead: 'Bring a key, point it at your own server, or use the models Taalcut runs on your computer.',
  ways: {
    'api-key': { label: 'With your API key', short: 'API key' },
    'own-server': { label: 'Your own server', short: 'Your server' },
    'on-device': { label: 'On your computer', short: 'Built in' },
  },
} as const;

/** /ai/ · API keys. */
export const API_KEYS = {
  heading: 'Your own API keys',
  lead: 'Paste a key in Settings › Accounts and Taalcut calls that provider for you. Taalcut keeps it encrypted with a key in your computer’s keychain, and never shows it back.',
  budget:
    'When you pay per use with a key, each new project starts with a budget of US$2. Taalcut checks it before paid work, and you can change it or turn it off.',
  /** The same budget as a tile beside the providers (packages/core settings/budget-contract.ts: US$2.00 by default; the app calls it a budget). */
  cap: ['A US$2 budget per project', 'Taalcut checks it before paid work. Change it or turn it off.'],
} as const;

/**
 * /ai/ · on this computer (packages/models: local-runtime/llama-cpp-spec.ts, mlx-spec.ts, hardware/tiers.ts,
 * registry/builtin-profiles.ts). Only models the code names: Qwen3.5 4B on llama.cpp from 16 GB (off a Mac, with a
 * GPU of 8 GB of video memory), Qwen3.5 9B on MLX on the High tier (32 GB and a GPU of 16 or more cores:
 * TIER_RULES.highGpuCores), a small text-only model on 8 GB, where vision moves to the cloud.
 */
export const ON_DEVICE = {
  heading: 'On your computer',
  lead: 'Taalcut downloads and runs its own models. There is nothing to install, and no server to set up.',
  facts: [
    ['Always here', 'Search, text in video and music beats. Your footage is indexed on your computer.'],
    ['Speech', 'Written down on your computer. It goes to ElevenLabs only if you add that key and allow it.'],
    ['The agent', 'Can run here: Qwen3.5 4B through llama.cpp on computers with 16 GB of memory or more.'],
    ['On Ubuntu', 'The agent on your computer needs a graphics card with 8 GB of video memory.'],
    ['High-end Macs', 'Qwen3.5 9B on MLX, on Apple silicon Macs with 32 GB of memory and a GPU with 16 or more cores.'],
    ['8 GB Macs', 'The agent runs a small text model. Understanding images needs a cloud model.'],
  ] satisfies readonly Fact[],
} as const;

/** /ai/ · the Local only switch (Settings › Privacy) and what leaves your computer (privacy-labels.ts). */
export const LOCAL_ONLY = {
  heading: 'Local only',
  lead: 'Turn on Local only in Settings › Privacy and nothing of yours leaves your computer, whichever profile you picked.',
  switchLabel: 'Local only',
  switchLine: 'Keep everything on this computer',
  whatLeaves: 'What leaves your computer',
  whenOn: 'Nothing of yours leaves your computer: no cloud models, uploads, reel links, feedback or usage counts.',
  /** The app's Update checks line (privacy-labels.ts): the version, plus a random ID made for this computer. */
  stillRuns: 'Update checks still send the app’s version and a random ID. Model downloads send nothing of yours.',
  leavesWhenOff: [
    ['Cloud models you chose', 'The agent’s messages and tool results, and video frames when a cloud model looks at a shot. Taalcut asks before it first sends your files to a cloud model.'],
    ['Reference links', 'Taalcut downloads a reel you paste, to read how it’s cut.'],
    ['Speech', 'Audio, only if you add an ElevenLabs key and allow it.'],
    ['Crash reports and usage counts', 'Only when you turn them on. Both start off.'],
  ] satisfies readonly Fact[],
  /** The cloud row's value while the On this Mac profile runs every job here. */
  cloudWithLocalProfile: 'None. This profile runs every job on your computer.',
  staysWhenOn: [
    ['Your footage', 'Indexed and searched on your computer.'],
    ['Reel links', 'Off. Drop the video file in instead.'],
    ['Jobs with no local model', 'Stay off until you turn Local only off.'],
  ] satisfies readonly Fact[],
} as const;

/** /ai/ · your own server: Settings › Accounts › Servers ("Advanced: bring your own server"), Ollama and LM Studio only. */
export const OWN_SERVER = {
  heading: 'Your own server',
  lead: 'If you already run Ollama or LM Studio, add it in Settings › Accounts › Servers. You never need one: Taalcut already runs models on your computer.',
} as const;
