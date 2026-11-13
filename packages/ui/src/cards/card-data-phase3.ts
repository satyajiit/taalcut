// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type {
  CleanupPlan,
  CleanupSettings,
  CommandId,
  HubBrowseItem,
  HubTemplateId,
  RenderSnapshot,
  Result,
  StockResult,
  StyleSummary,
  TaalcutError,
  TimelineId,
} from '@taalcut/core';
import type { ReactNode } from 'react';
import type { PreviewPlayFrom } from '../media/media-types';
import type { TimelinePreviewProps } from './timeline-preview';

/**
 * What Phase 3's cards read (contract round P3-1); CardData extends it. Each member is optional, so a card
 * without it keeps its snapshot.
 */
export interface CardDataPhase3 {
  /** P3-B3: the bundled starters for the app's language, best fit first (templates.starters). */
  starters?(): Promise<readonly StarterChoice[]>;
  /** P3-B4, P3-B5: the phone panel the source picker hosts (Wi-Fi or a cable); the renderer supplies it. */
  phonePanel?(method: PhoneMethod): ReactNode;
  /**
   * P3-B4: whether a phone is on a cable now (transfer.devices lists one), then every change, so the source picker
   * offers the cable first. Returns the unsubscribe.
   */
  watchPhoneOnCable?(onChange: (listed: boolean) => void): () => void;
  /**
   * P3-V3: the newest render of a timeline for a purpose, then every change; `onError` when the watch broke for a
   * reason other than the render being gone (UX round 1, as CardData.watchRender). Returns the unsubscribe.
   */
  watchLatestRender?(
    timelineId: TimelineId,
    purpose: 'draft' | 'export',
    onChange: (render: RenderSnapshot | null) => void,
    onError?: (error: TaalcutError) => void,
  ): () => void;
  /** P3-V18: stock search (library.stockSearch); undefined when stock is off in this build. */
  stockSearch?(query: {
    readonly query: string;
    readonly kind: 'video';
    readonly orientation?: 'portrait' | 'landscape' | 'square';
  }): Promise<Result<{ readonly items: readonly StockResult[] }>>;
  /** P3-B12: a hub entry as the index says now; undefined when not in the index. */
  hubItem?(hubId: HubTemplateId): Promise<HubBrowseItem | undefined>;
  /** P3-V9: a cleanup plan for other switches (timelines.planCleanup); a read. */
  planCleanup?(input: {
    readonly timelineId: TimelineId;
    readonly settings: Partial<CleanupSettings>;
  }): Promise<Result<CleanupPlan>>;
  /** P3-V10: looks for pickers and chips (styles.list). */
  styles?(): Promise<readonly StyleSummary[]>;
  /** A brand kit asset's URL (app://media/styles/<sha256>); null when it has none. */
  styleAssetUrl?(sha256: string): string | null;
  /**
   * P3-V16: the command id of the change app-wide undo would undo next (null: none, or not known), now and after
   * every change. Returns the unsubscribe.
   */
  watchNewestChange?(onChange: (commandId: CommandId | null) => void): () => void;
  /** P3-B6: the timeline preview that also plays from a frame when asked (the voiceover's per-line Play). */
  renderPreviewFrom?(props: TimelinePreviewProps & { readonly playFrom: PreviewPlayFrom | null }): ReactNode;
  /** P3-V13: an artifact's URL the CSP allows (a motion graphic's poster); null shows the viewer grey. */
  artifactUrl?(artifactId: string): string | null;
}

/** How a phone's clips come in: over the Wi-Fi import page, or a cable (transfer's USB picker). */
export type PhoneMethod = 'wifi' | 'cable';

/**
 * A bundled starter in "Start from a template" and onboarding (P3-B3): picking it dispatches
 * template.addStarter under a new id, then starts the chat at that template.
 */
export interface StarterChoice {
  readonly kind: 'starter';
  /** core's StarterSummary.starterId. */
  readonly starterId: string;
  /** Already in the user's language. */
  readonly name: string;
  /** "Lots of short clips", already in the user's language. */
  readonly needs: string;
  readonly slotCount: number;
  readonly seconds: number;
  /** Placeholder block lengths in seconds for the preview (D9: no frames). */
  readonly blocks: readonly number[];
}
