// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The `timeline` agent tools, one family per file: casting, reads, one write
 * tool per edit command (refused by the command on locked clips), and the
 * Phase 3 families. A new family is a new file and one line here.
 */
import { defineToolModule, type SubjectSource, type ToolModule } from '@taalcut/core';
import type { CastingEngine } from '../casting/engine';
import type { TemplateFitter } from '../fit/fit-templates';
import type { TimelineService } from '../service/service';
import type { SubjectDeps } from '../assembly/subjects';
import type { TemplateReader } from '../service/templates';
import type { VariantMusicDeps } from '../variants/variant-deps';
import type { CompositionFiles } from '../assembly/composition-files';
import { coverTool } from './cover-tool';
import { visualLayoutTool } from './visual-layout-tool';
import { castTools } from './cast-tools';
import { cleanupTools } from './cleanup-tools';
import { createClipNumbering, type ClipNumbering } from './clip-refs';
import { editTools } from './edit-tools';
import { editorTools } from './editor-tools';
import { energyTools } from './energy-tools';
import { fitTools } from './fit-tools';
import { gapTools } from './gap-tools';
import type { GraphicsReady } from './graphics-wait';
import { interchangeTools } from './interchange-tools';
import { readTools } from './read-tools';
import type { ShotDescriptions } from './rerank-material';
import { styleTools } from './style-tools';
import { simpleEditorTools } from './simple-editor-tools';
import { variantTools } from './variant-tools';

export interface TimelineToolDeps extends SubjectDeps {
  readonly engine: CastingEngine;
  readonly service: TimelineService;
  readonly templates: TemplateReader;
  readonly clock: { now(): number };
  /** P3-V3: the music axis of `timeline.makeVariants`. Absent: an own track keeps the cuts where they are. */
  readonly music?: VariantMusicDeps;
  /** LRN1-TPL: `timeline.fitTemplates`, once the template index is wired. */
  readonly fit?: TemplateFitter;
  /** FIX-LIBRARIAN: what indexing said each shot shows, for `timeline.cast`'s rerank list. Absent: no list. */
  readonly shotDescriptions?: ShotDescriptions;
  /** FRM1-OVL: who is in each clip, so `timeline.assemble` places overlays clear of heads. */
  readonly subjects?: SubjectSource;
  /** HFW1: puts a template's composition files into the project for `timeline.assemble` (cast-tools.ts). */
  readonly workspace?: CompositionFiles;
  /**
   * EDT1-OPS: the clips' numbering, shared with the `audio` module's sound edits (`clipNumberingOf` the timeline
   * store), so a number read with timeline.get counts there too. Absent: this module's own.
   */
  readonly numbering?: ClipNumbering;
  /** FIX-GFXWAIT: `timeline.cast` and `timeline.assemble` wait for a template's graphics being designed. */
  readonly graphicsReady?: GraphicsReady;
}

export { sha256 } from './hash';

export function timelineToolModule(deps: TimelineToolDeps): ToolModule {
  // EDT1-OPS: the clips' numbering timeline.get showed, so an edit tool takes a number read a few edits back.
  const numbering = deps.numbering ?? createClipNumbering();
  const editorDeps = {
    service: deps.service,
    numbering,
    ...(deps.shotDescriptions ? { shotDescriptions: deps.shotDescriptions } : {}),
  };
  return defineToolModule({
    id: 'timeline',
    tools: [
      ...castTools(deps),
      ...readTools({ ...deps, numbering }),
      ...editTools(editorDeps),
      // EDT1-OPS: the editor's full set of edits and the sound's.
      ...editorTools(editorDeps),
      ...simpleEditorTools(deps.service),
      coverTool(deps.service),
      visualLayoutTool(),
      ...interchangeTools(),
      ...gapTools(deps.service),
      ...cleanupTools(deps.service),
      ...energyTools(deps.service),
      ...variantTools(deps),
      ...styleTools(deps.service),
      ...fitTools(deps.fit),
    ],
  });
}
