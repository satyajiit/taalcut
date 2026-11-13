// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { localStorageAcknowledgementStore, memoryAcknowledgementStore, type HostPlatform } from '@taalcut/ui';
import {
  createFakeChatClient,
  fakeOptionsFromStorage,
  type FakeChatClient,
  type FakeOptions,
} from '../chat/fake-client';
import { handoffStore } from '../chat/handoff';
import { selectionStore } from '../chat/selection-store';
import { createFakeMedia } from '../backend/fake/fake-media';
import { fakeSystemFromStorage, fakeSystemPlatform } from '../backend/fake/fake-system';
import { paletteStore } from '../features/palette/palette-state';
import { createFakeRecoveryClient, type FakeRecovery } from '../recovery/fake-recovery';
import { StandInViewer } from '../features/timeline/preview/stand-in-viewer';
import type { AppServices } from './provider';

declare global {
  interface Window {
    /**
     * Only with the preview services (a plain browser, no main): the fake chat
     * itself, so end-to-end tests can act as another window would (stop a run
     * the page still shows, say). Electron never has it.
     */
    taalcutFakeChat?: FakeChatClient;
    /** Likewise the fake recovery report: `agentRestarted()` is main re-offering a cut-off run. */
    taalcutFakeRecovery?: FakeRecovery;
  }
}

/**
 * The services in a plain browser (the dev server, the renderer's end-to-end
 * tests), where there is no main to connect to: scripted fakes, with
 * acknowledgements in localStorage. In Electron, main.tsx builds them over
 * main's port instead (main.ts).
 */
/** Commands that change what a flow made (a slot, a clip), as the agent's FlowWatcher follows them. */
const FLOW_EDITS = /^(template\.slot\.|timeline\.(swapClip|trimClip|lockClip|moveClip))/;

/**
 * The fake agent's flow watcher: a person's change to what a flow made, on the fake backend's bus, while a
 * run waits on the export approval. The backend fake loads beside this one, so it is looked for until it is there.
 */
function watchFlowEdits(chat: FakeChatClient, tries = 100): void {
  const backend = window.taalcutFake;
  if (!backend) {
    if (tries > 0) setTimeout(() => watchFlowEdits(chat, tries - 1), 50);
    return;
  }
  backend.events.on('command.changed', ({ payload }) => {
    if (payload.source !== 'agent' && FLOW_EDITS.test(payload.name)) chat.noteEdit();
  });
}

export function createPreviewServices(options: FakeOptions = fakeOptionsFromStorage()): AppServices {
  const fake = createFakeChatClient(options);
  watchFlowEdits(fake);
  const recovery = createFakeRecoveryClient(options.recovery);
  window.taalcutFakeChat = fake;
  window.taalcutFakeRecovery = recovery;
  return {
    chat: fake,
    commands: fake.commands,
    acknowledgements: localStorageAcknowledgementStore(),
    recovery,
    // No window behind a plain browser page: the bar is drawn, its controls inert.
    window: null,
    // No app://media host either: the fake library's footage is painted in the page.
    media: createFakeMedia(),
    // No render process to compile a preview: the timeline is painted in the page too.
    viewer: StandInViewer,
    // The fake machine's OS, so a Linux fixture reads as Linux on any host; the Mac otherwise.
    platform: fakeSystemPlatform(fakeSystemFromStorage()),
  };
}

/** Instant, in-memory services for unit tests; `chat` is the fake, so tests can rename. */
export function createTestServices(
  options: FakeOptions = { latencyMs: 0, speed: 0 },
  platform: HostPlatform = 'mac',
): AppServices & { chat: FakeChatClient } {
  paletteStore.reset();
  selectionStore.reset();
  handoffStore.reset();
  const fake = createFakeChatClient(options);
  return {
    chat: fake,
    commands: fake.commands,
    acknowledgements: memoryAcknowledgementStore(),
    recovery: createFakeRecoveryClient(options.recovery),
    window: null,
    media: createFakeMedia(),
    viewer: StandInViewer,
    platform,
  };
}
