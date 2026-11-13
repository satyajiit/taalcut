// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { AsyncResult, ChatService } from '@taalcut/core';
import type { AcknowledgementStore, HostPlatform } from '@taalcut/ui';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { MediaUrls } from '../backend/media';
import type { TimelineViewer } from '../features/timeline/preview/viewer-types';
import type { RecoveryClient } from '../recovery/client';
import type { WindowClient } from '../shell/window-client';

/**
 * Runs a command on the bus: an error card's fix, for one. The shape of
 * `commandsContract.dispatch`, with a Result instead of a throw.
 */
export interface CommandDispatcher {
  dispatch(input: {
    name: string;
    payload?: unknown;
    source: 'ui' | 'shortcut';
    idempotencyKey?: string;
  }): AsyncResult<unknown>;
}

/**
 * Everything the renderer reaches outside itself, each behind a typed client.
 * main.tsx builds them: over main's port in Electron (services/main.ts), as
 * in-page fakes in a plain browser (services/create.ts). Tests build their own.
 */
export interface AppServices {
  /** Core's chat service: every method returns a Result, and the UI never sees a throw from it. */
  chat: ChatService;
  commands: CommandDispatcher;
  acknowledgements: AcknowledgementStore;
  recovery: RecoveryClient;
  /** The window the page lives in (Electron); null in a plain browser, where the bar's controls are inert. */
  window: WindowClient | null;
  /** Where thumbnails, posters and contact sheets load from (main's media host, or the fake's paintings). */
  media: MediaUrls;
  /**
   * The OS the app runs on (LNX1-SHL): Electron's page reads it from its navigator; the preview from its fake machine
   * (the Mac unless `system` says otherwise); tests choose. App provides it to the kit (HostPlatformProvider).
   */
  platform: HostPlatform;
  /**
   * The fake's stand-in preview, in a plain browser with no render process (P2-M7). Absent in Electron, where
   * timelines play in render's preview session (the kit's PreviewPlayer).
   */
  viewer?: TimelineViewer;
}

interface ServicesContext {
  services: AppServices;
  /** Bumped when a conversation is created or changes, so the list reloads. */
  revision: number;
  conversationsChanged: () => void;
  /** Bumped when recovery resumes unfinished runs, so an already-open conversation reloads and follows. */
  resumed: number;
  runsResumed: () => void;
}

const Context = createContext<ServicesContext | null>(null);

export function ServicesProvider({ services, children }: { services: AppServices; children: ReactNode }) {
  const [revision, setRevision] = useState(0);
  const [resumed, setResumed] = useState(0);
  const conversationsChanged = useCallback(() => setRevision((n) => n + 1), []);
  const runsResumed = useCallback(() => setResumed((n) => n + 1), []);
  const value = useMemo(
    () => ({ services, revision, conversationsChanged, resumed, runsResumed }),
    [services, revision, conversationsChanged, resumed, runsResumed],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

function useServicesContext(): ServicesContext {
  const context = useContext(Context);
  if (!context) throw new Error('The app needs a <ServicesProvider> above it');
  return context;
}

export function useServices(): AppServices {
  return useServicesContext().services;
}

export function useMediaUrls(): MediaUrls {
  return useServicesContext().services.media;
}

/** The conversation list's revision and the function that bumps it. */
export function useConversationsRevision(): [number, () => void] {
  const { revision, conversationsChanged } = useServicesContext();
  return [revision, conversationsChanged];
}

/** Bumped when recovery resumes unfinished runs so an open chat clears its restart error and attaches. */
export function useRunsResumed(): [number, () => void] {
  const { resumed, runsResumed } = useServicesContext();
  return [resumed, runsResumed];
}
