// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What every export dialog section gets (apps/renderer SPEC, "Export dialog sections"): the export options, and
 * the timeline, Style and credits behind them, because the render lane's options don't carry the voiceover, the
 * mix, the reframed clips or the bumpers. A section reads them, dispatches its own commands, and changes the
 * export's own choices (where it's going, captions, bumpers) through `choose`.
 */
import type {
  Credits,
  ExportOptions,
  ExportPresetId,
  ExportVideoCodec,
  FrameRate,
  ProjectId,
  Result,
  Style,
  TaalcutError,
  Timeline,
  TimelineId,
  TimelineItemId,
} from '@taalcut/core';
import type { ComponentType } from 'react';

export const EXPORT_SECTION_IDS = [
  'where',
  'music',
  'voice',
  'captions',
  'reframe',
  'aiLabel',
  'credits',
  'otherEditors',
] as const;
export type ExportSectionId = (typeof EXPORT_SECTION_IDS)[number];

/** library.credits for the timeline's assets: the lines, or why they didn't load. */
export type CreditsState =
  | { readonly status: 'ready'; readonly credits: Credits }
  | { readonly status: 'error'; readonly error: TaalcutError };

export interface ExportContext {
  readonly projectId: ProjectId;
  readonly timelineId: TimelineId;
  readonly options: ExportOptions;
  readonly timeline: Timeline;
  /** The timeline's Style when it has one (its intro and outro); null without one or when it can't be read. */
  readonly style: Style | null;
  readonly credits: CreditsState;
}

/** What render.export sends besides the timeline: the person's choices in this dialog. */
export interface ExportChoices {
  readonly presetId: ExportPresetId;
  /** LNX1-AV1: the video format on a preset that offers more than one (Shorts, Reels, TikTok); absent: its default. */
  readonly codec?: ExportVideoCodec | undefined;
  /** The export frame rate when a multiple of the timeline's rate (such as 60 fps) is chosen; absent: the timeline's rate. */
  readonly rate?: FrameRate | undefined;
  readonly burnIn: boolean;
  readonly srt: boolean;
  readonly includeBumpers: boolean;
}

export interface SectionProps {
  readonly context: ExportContext;
  readonly choices: ExportChoices;
  readonly choose: (patch: Partial<ExportChoices>) => void;
  /** A command from the person (source 'ui', a fresh idempotency key). */
  readonly dispatch: (name: string, payload: unknown) => Promise<Result<unknown>>;
  /** Reads the options again after a change the timeline doesn't show (Content Credentials). */
  readonly reload: () => void;
  /** Puts words in the editor's composer, unsent, and goes there (paid work goes through Taalcut). */
  readonly ask: (text: string) => void;
  /** The editor on this timeline, with this clip selected. */
  readonly review: (clipId: TimelineItemId) => void;
  /** Nothing changes while the export starts. */
  readonly disabled: boolean;
}

export interface ExportSection {
  readonly id: ExportSectionId;
  /** Whether the section shows at all, when the dialog opens. */
  readonly available: (context: ExportContext) => boolean;
  readonly Component: ComponentType<SectionProps>;
}
