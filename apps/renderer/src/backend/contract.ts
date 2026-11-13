// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What Settings (Privacy, budgets in Usage), first run, Send feedback, the
 * trace viewer, ⌘K, the UI actions, the library, Wi-Fi import and the
 * template pages call: these namespaces of core's appContract (main serves
 * or forwards them; see APP_ROUTES). In Electron, `connectToMain(window)`'s client is the backend;
 * in a plain browser, the in-page fake (fake/fake-backend.ts) serves the same
 * contract over a MessageChannel.
 */
import { appContract, type RpcClient } from '@taalcut/core';

const { commands, events, models, accounts, usage, system, traces, consents } = appContract;
const { library, indexing, transfer, templates, files, imports } = appContract;
const { budget, privacy, onboarding, telemetry, feedback, updates } = appContract;
// Make (P2-M3, P2-M7, P2-M8, P2-M11, P2-X3): projects and their versions, timelines, renders and previews.
const { projects, timelines, renders } = appContract;
// Phase 3 (ui-onboarding): the app's language (P3-L2), External agents (P3-V4), and the agent's acknowledgements
// (the beta terms gate updates.setChannel, so they are recorded where its handler reads them).
const { locale, mcp, mcpSetup, acknowledgements } = appContract;
// Phase 3 (ui-make): brand kits and looks (P3-V10), the template hub (P3-B12, P3-V8) and the microphone for a
// voice consent (P3-B6, main's).
const { styles, hub, voiceCapture } = appContract;
const { plugins, pluginsSetup } = appContract;
// LRN1-MEM: Settings → Memory (the agent's memory service; MEMORY_COMMANDS go through `commands`).
const { memory } = appContract;
// LIB1-LANG: the languages you speak (Settings › General, first run; the command goes through `commands`).
const { speech, interfaceSounds } = appContract;
// EDT1-CMT: the editor's comments, live (COMMENT_COMMANDS go through `commands`).
const { comments } = appContract;
// HFW1-UI: the editor's files viewer, read-only (WORKSPACE_COMMANDS go through `commands`).
const { workspace, creation, products, productBackground, productPublishing } = appContract;

const jobs = { get: appContract.jobs.get };

export const backendContract = {
  jobs,
  commands,
  events,
  models,
  accounts,
  usage,
  system,
  traces,
  consents,
  library,
  imports,
  indexing,
  transfer,
  templates,
  files,
  budget,
  privacy,
  onboarding,
  telemetry,
  feedback,
  updates,
  projects,
  timelines,
  renders,
  locale,
  mcp,
  mcpSetup,
  acknowledgements,
  styles,
  hub,
  voiceCapture,
  plugins,
  pluginsSetup,
  memory,
  speech,
  interfaceSounds,
  comments,
  workspace,
  creation,
  products,
  productBackground,
  productPublishing,
};

export type BackendContract = typeof backendContract;
export type Backend = RpcClient<BackendContract>;
