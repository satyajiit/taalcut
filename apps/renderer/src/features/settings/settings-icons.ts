// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Settings' glyphs (UX4): every section heading, row and view in Settings takes its glyph from here, and this takes
 * each from the kit's registry (`CONCEPT_ICONS`, `VERB_ICONS`), named by Settings' own words, so one glyph stays one
 * thing across the app. Never pick one at a call site.
 */
import { CONCEPT_ICONS, VERB_ICONS } from '@taalcut/ui';
import type { LucideIcon } from 'lucide-react';

export const SETTINGS_ICONS = {
  // The sidebar's sections.
  general: CONCEPT_ICONS.general,
  models: CONCEPT_ICONS.model,
  accounts: CONCEPT_ICONS.account,
  plugins: CONCEPT_ICONS.plugin,
  externalAgents: CONCEPT_ICONS.externalAgent,
  sources: CONCEPT_ICONS.source,
  brandKits: CONCEPT_ICONS.brandKit,
  privacy: CONCEPT_ICONS.privacy,
  memory: CONCEPT_ICONS.memory,
  usage: CONCEPT_ICONS.usage,
  // General's views and sections.
  updates: CONCEPT_ICONS.update,
  thisMac: CONCEPT_ICONS.thisComputer,
  about: CONCEPT_ICONS.about,
  language: CONCEPT_ICONS.language,
  // LIB1-LANG: the languages in your clips, as the clip's facts lead Sound.
  spokenLanguages: CONCEPT_ICONS.caption,
  appearance: CONCEPT_ICONS.appearance,
  sound: CONCEPT_ICONS.sound,
  help: CONCEPT_ICONS.help,
  gpu: CONCEPT_ICONS.gpu,
  parts: CONCEPT_ICONS.parts,
  licences: CONCEPT_ICONS.licence,
  feedback: CONCEPT_ICONS.feedback,
  // Usage's views.
  overview: CONCEPT_ICONS.usage,
  breakdown: CONCEPT_ICONS.breakdown,
  budgets: CONCEPT_ICONS.budget,
  requests: CONCEPT_ICONS.request,
  // Accounts' views.
  connected: CONCEPT_ICONS.connected,
  keys: CONCEPT_ICONS.account,
  subscriptions: CONCEPT_ICONS.subscription,
  servers: CONCEPT_ICONS.server,
  // A plugin's views.
  connection: CONCEPT_ICONS.connection,
  access: CONCEPT_ICONS.privacy,
  tools: CONCEPT_ICONS.tool,
  skills: CONCEPT_ICONS.skill,
  // A brand kit's views.
  colours: CONCEPT_ICONS.colour,
  type: CONCEPT_ICONS.text,
  captions: CONCEPT_ICONS.caption,
  logo: CONCEPT_ICONS.image,
  bumpers: CONCEPT_ICONS.reel,
  // Models' and Privacy's views.
  profile: CONCEPT_ICONS.model,
  jobs: CONCEPT_ICONS.job,
  downloads: VERB_ICONS.download,
  whatLeaves: CONCEPT_ICONS.privacy,
  sharing: CONCEPT_ICONS.sharing,
  uploads: CONCEPT_ICONS.upload,
  cloud: CONCEPT_ICONS.cloud,
  localOnly: CONCEPT_ICONS.thisComputer,
  // Verbs that Settings uses beyond the registry's own.
  openPage: VERB_ICONS.open,
} as const satisfies Record<string, LucideIcon>;
