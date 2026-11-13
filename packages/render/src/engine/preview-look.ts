// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a preview draws besides the timeline, as the export does (P3-V2, P3-V10): the Style (its bumpers are the
 * export's alone) and each reframed clip's framing from its stored subject track. A preview never tracks: a
 * shot without a stored track shows the centre crop until the export (or the jobs queue) has tracked it.
 */
import { ok, type AsyncResult, type ExportPreset, type Timeline } from '@taalcut/core';
import type { CaptionLayout, CompileOptions, CompositionMediaEntry } from '../compile/composition';
import { planForPreset } from '../plan/canvas';
import { styleExport } from '../style/export-style';
import type { RenderEngineDeps } from './deps';
import { planFramingWith } from './stages/framing';
import { workspaceOf } from '../workspace/fold/workspace-of';
import { planHeads } from './stages/heads';

export type PreviewLook = Pick<
  CompileOptions,
  'style' | 'brandAssets' | 'framing' | 'cropStyle' | 'captionAnchors' | 'keepOut' | 'workspace'
>;

export async function previewLook(
  deps: RenderEngineDeps,
  timeline: Timeline,
  preset: ExportPreset,
  entries: ReadonlyMap<string, CompositionMediaEntry>,
  captionLayout: CaptionLayout,
): AsyncResult<PreviewLook> {
  const styled = await styleExport(
    { assets: deps.assets, media: deps.media, ...(deps.styles ? { styles: deps.styles } : {}) },
    timeline,
    false,
  );
  if (!styled.ok) return styled;
  const { style, brandAssets } = styled.value;
  const plan = planForPreset(timeline, preset);
  if (!plan.ok) return plan;
  const context = {
    ...(deps.subjectTracks ? { subjectTracks: deps.subjectTracks } : {}),
    media: deps.media,
    burnCaptions: true,
    trackMissing: false,
    conform: false,
  };
  const inputs = {
    plan: plan.value,
    timeline,
    preset,
    captionLayout,
    sources: new Map([...entries].map(([id, entry]) => [id, { path: entry.file }])),
  };
  const framed = await planFramingWith(context, inputs);
  if (!framed.ok) return framed;
  // FRM1-OVL: graphics keep out of the stored tracks' heads, as the export's do.
  const heads = await planHeads(context, inputs, framed.value);
  return ok({
    style,
    brandAssets: (sha256) => brandAssets.get(sha256),
    ...(framed.value ? framed.value.compose : {}),
    ...(heads.ok && heads.value.keepOut.length > 0 ? { keepOut: heads.value.keepOut } : {}),
    ...workspaceOf(deps.workspaceRoot, timeline.projectId),
  });
}
