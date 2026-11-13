// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the workspace tools run on (HFW1 "dsn"): the project's workspace store (the library's, through core's
 * port), the timelines, the gate (render's own unless a test gives another), the render worker's stills, and the
 * stores the brief and `workspace.promote` read. Everything but the store and the timelines is optional: without
 * stills `workspace.render` says it can't, without templates `workspace.promote` does.
 */
import type {
  AsyncResult,
  CommentToolView,
  GraphicCompositionId,
  GraphicSystem,
  Style,
  TemplateGraphics,
  TemplateId,
  Timeline,
  TimelineId,
  WorkspaceFramesInput,
  WorkspaceFramesOutput,
  WorkspaceStore,
} from '@taalcut/core';
import type { TimelineAccess } from '../../ports';
import type { WorkspaceGateInput, WorkspaceGateResult } from '../gate/workspace-gate';

/** A template's graphics as `template.setGraphics` replaces them, with the version it was made on. */
export interface TemplateGraphicsSource {
  graphics(
    templateId: TemplateId,
  ): AsyncResult<{ readonly version: number; readonly graphics: TemplateGraphics | null }>;
}

/** The model that is designing now, for a composition's provenance; null when none can say. */
export type DesignerOf = () => Promise<{ readonly id: string; readonly onDevice: boolean } | null>;

export interface WorkspaceToolDeps {
  readonly store: WorkspaceStore;
  readonly timelines: TimelineAccess;
  /** The gate; default render's own (gate/workspace-gate.ts). */
  readonly gate?: (input: WorkspaceGateInput) => Promise<WorkspaceGateResult>;
  /** Stills of a composition over the footage or grey (RenderWorker.workspaceFrames, through main). */
  readonly frames?: (
    input: WorkspaceFramesInput,
    options: { readonly signal: AbortSignal },
  ) => AsyncResult<WorkspaceFramesOutput>;
  /** For `workspace.promote`. */
  readonly templates?: TemplateGraphicsSource;
  /** The video's look for the brief: its template's graphic system and its Style. */
  readonly look?: (
    timeline: Timeline,
  ) => Promise<{ readonly system?: GraphicSystem | null; readonly style?: Style | null }>;
  /** The timeline's open comments, for the brief. */
  readonly comments?: (timelineId: TimelineId) => AsyncResult<readonly CommentToolView[]>;
  readonly designer?: DesignerOf;
  readonly now?: () => number;
  readonly newCompositionId?: () => GraphicCompositionId;
}
