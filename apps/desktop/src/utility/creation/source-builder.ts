// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import {
  authoredProgramDigestInput,
  newId,
  ok,
  RationalTime,
  type AsyncResult,
  type AuthoredProgram,
  type AuthoredProgramStore,
  type Container,
  type CreationDraft,
  type ProjectId,
  type VideoAspect,
} from '@taalcut/core';
import type { CreationScene } from '@taalcut/agent';
import { inspectAuthoredProgram } from '@taalcut/render';
import { creationImage } from './model';

const canvases: Record<VideoAspect, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
};

export function creationSource(
  draft: CreationDraft,
  scenes: readonly CreationScene[],
  format: VideoAspect,
  master?: CreationScene,
): string {
  const size = canvases[format];
  const seconds =
    draft.beats.reduce((sum, beat) => sum + RationalTime.toFrames(beat.duration, { num: 60, den: 1 }), 0) /
    60;
  return `<template><style>
#root{position:relative;width:${size.width}px;height:${size.height}px;overflow:hidden;background:#101218;color:#ffffff;font-family:'Noto Sans',sans-serif;}
#master-camera{position:absolute;left:0;top:0;width:${size.width}px;height:${size.height}px;}
${master?.css ?? ''}
${scenes.map((scene) => scene.css).join('\n')}
</style><div id="root" data-hf-id="hf-root" data-composition-id="film" data-width="${size.width}" data-height="${size.height}" data-duration="${seconds}">
<div id="master-camera" data-hf-id="master-camera">
${scenes.map((scene) => scene.html).join('\n')}
</div>${master?.html ?? ''}
</div><script>const tl=gsap.timeline({paused:true});
${master?.animation ?? ''}
${scenes.map((scene) => scene.animation).join('\n')}
window.__timelines['film']=tl;</script></template>`;
}

/** Resolve only attached library images. Generated source never gets to read a raw host path or fetch a URL. */
export async function buildCreationProgram(
  container: Container,
  store: AuthoredProgramStore,
  projectId: ProjectId,
  draft: CreationDraft,
  scenes: readonly CreationScene[],
  format: VideoAspect,
  assets: readonly AuthoredProgram['assetIds'][number][],
  previous?: AuthoredProgram,
  preview = false,
  master?: CreationScene,
): AsyncResult<{ program: AuthoredProgram; source: string }> {
  let source = creationSource(draft, scenes, format, master);
  const files: AuthoredProgram['files'] = [];
  const used: AuthoredProgram['assetIds'] = [];
  for (const assetId of assets) {
    if (!source.includes(`assets/${assetId}`)) continue;
    const image = await creationImage(container, assetId);
    if (!image.ok) return image;
    const file = await store.putFile(projectId, Buffer.from(image.value.data, 'base64'));
    if (!file.ok) return file;
    source = source.replaceAll(`assets/${assetId}`, `assets/${file.value.sha256}`);
    if (!files.some((existing) => existing.sha256 === file.value.sha256))
      files.push({ path: `assets/${file.value.sha256}`, ...file.value });
    used.push(assetId);
  }
  const entry = `${preview ? 'style' : 'film'}-${format.replace(':', '-')}.html`;
  const sourceFile = await store.putFile(projectId, new TextEncoder().encode(source));
  if (!sourceFile.ok) return sourceFile;
  files.push({ path: entry, ...sourceFile.value });
  const rate = { num: 60, den: 1 };
  let frame = 0;
  const chapters = draft.beats.map((beat) => {
    const duration = RationalTime.rescale(beat.duration, rate, 'round');
    const chapter = {
      id: beat.id,
      name: (beat.screenText || beat.id).slice(0, 200),
      start: RationalTime.of(frame, rate),
      duration,
    };
    frame += duration.value;
    return chapter;
  });
  const bare = {
    id: previous?.id ?? newId<'AuthoredProgram'>(),
    version: (previous?.version ?? 0) + 1,
    entry,
    files,
    canvas: { ...canvases[format], rate },
    duration: RationalTime.of(frame, rate),
    chapters,
    assetIds: used,
  };
  let program = {
    ...bare,
    hash: createHash('sha256').update(authoredProgramDigestInput(bare)).digest('hex'),
  };
  const validated = inspectAuthoredProgram(source, program);
  if (!validated.ok) return validated;
  if (validated.value.source !== source) {
    source = validated.value.source;
    const stamped = await store.putFile(projectId, new TextEncoder().encode(source));
    if (!stamped.ok) return stamped;
    program = {
      ...program,
      files: program.files.map((file) => (file.path === entry ? { path: entry, ...stamped.value } : file)),
    };
    program.hash = createHash('sha256').update(authoredProgramDigestInput(program)).digest('hex');
  }
  return ok({ program, source });
}
