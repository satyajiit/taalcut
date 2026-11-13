// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The fold on the contracts (HFW1 hf): a timeline's composition graphics are planned from their refs and the
 * timeline's copies, read from the workspace by sha256, prepared and drawn, with their assets linked by sha256; a
 * proposal, a missing copy and a copy the gate did not pass are left out with a warning.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  graphicCompositionSchema,
  newId,
  RationalTime,
  workspaceBlobPath,
  type GraphicComposition,
  type Timeline,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { compileComposition } from '../../src/compile/composition';
import { presetFor } from '../../src/presets/presets.v1';
import { planTimeline } from '../../src/plan/render-plan';
import type { WorkspaceReader } from '../../src/workspace/fold/placements';
import { sniffImage, workspaceReaderAt } from '../../src/workspace/fold/reader';
import { at } from '../support/timeline';
import { fixtureText, stillTimeline } from './support';

const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PNG_SHA = sha(PNG);
const PROJECT = newId<'Project'>();

async function headline(): Promise<string> {
  return (await fixtureText('headline.html')).replace(
    '#card {\n',
    `#card {\n          background-image: url(assets/${PNG_SHA});\n`,
  );
}

function copyOf(html: string, passed = true): GraphicComposition {
  const entry = { path: 'index.html', sha256: sha(html), bytes: Buffer.byteLength(html) };
  return graphicCompositionSchema.parse({
    id: newId<'GraphicComposition'>(),
    version: 1,
    hash: sha('made-up hash input'),
    name: 'Headline',
    entry: 'index.html',
    files: [entry, { path: `assets/${PNG_SHA}`, sha256: PNG_SHA, bytes: PNG.length }],
    variables: [],
    durationSeconds: 4,
    provenance: { model: { id: 'test-model', onDevice: true }, overlays: [], brief: null, createdAt: 1 },
    gate: {
      version: 'hfw1.1',
      passed,
      checkedAt: 1,
      hfLint: { errors: 0, warnings: 0 },
      checks: [],
      loweredTweens: 3,
    },
  });
}

/** The still timeline with composition graphics on a text track. */
function withGraphics(
  copies: readonly GraphicComposition[],
  items: readonly { copy: GraphicComposition; start: number; proposal?: boolean; title?: string }[],
): Timeline {
  const base = stillTimeline(300);
  const rate = base.canvas.rate;
  const graphics = items.map(({ copy, start, proposal, title }) => ({
    type: 'graphic' as const,
    id: newId<'TimelineItem'>(),
    anchor: { kind: 'time' as const, at: at(start, rate) },
    start: at(start, rate),
    duration: at(120, rate),
    placement: 'center' as const,
    styleKey: 'graphic',
    language: 'en',
    origin: 'agent' as const,
    composition: { id: copy.id, hash: copy.hash, params: title ? { title } : {} },
    ...(proposal ? { proposal: { request: 'a made-up request', design: 'designed', createdAt: 1 } } : {}),
  }));
  return {
    ...base,
    projectId: PROJECT,
    tracks: [...base.tracks, { kind: 'text', id: 'T9', name: 'Graphics', enabled: true, items: graphics }],
    graphicCompositions: [...copies],
  } as Timeline;
}

const memoryReader = (texts: Record<string, string>, asset?: string): WorkspaceReader => ({
  text: (sha256) => texts[sha256],
  asset: (sha256) => (asset && sha256 === PNG_SHA ? { file: asset, ext: 'png' } : undefined),
});

const compile = (timeline: Timeline, workspace?: WorkspaceReader) => {
  const compiled = compileComposition(timeline, {
    variant: 'export',
    preset: presetFor('device'),
    burnCaptions: false,
    media: () => ({
      file: '/x/still.png',
      key: 'still',
      mediaStart: RationalTime.zero(timeline.canvas.rate),
      ext: 'png',
    }),
    ...(workspace ? { workspace } : {}),
  });
  if (!compiled.ok) throw new Error(compiled.error.code);
  return compiled.value;
};

describe('folding a timeline’s composition graphics', () => {
  it('plans them from their refs, leaving out a proposal, a missing copy and one that failed the gate', async () => {
    const html = await headline();
    const good = copyOf(html);
    const failed = copyOf(html, false);
    const absent = copyOf(`${html} `);
    const timeline = withGraphics(
      [good, failed],
      [
        { copy: good, start: 30, title: 'Made-up words' },
        { copy: good, start: 60, proposal: true },
        { copy: failed, start: 90 },
        { copy: absent, start: 120 },
      ],
    );
    const plan = planTimeline(timeline);
    if (!plan.ok) throw new Error(plan.error.code);
    expect(plan.value.compositions?.map((planned) => [planned.span, planned.values])).toEqual([
      [{ start: 30, end: 150 }, { title: 'Made-up words' }],
    ]);
    expect(plan.value.warnings.filter((note) => note.includes('composition'))).toHaveLength(2);
  });

  it('draws one read from the workspace, its words filled and its asset linked by sha256', async () => {
    const html = await headline();
    const good = copyOf(html);
    const timeline = withGraphics([good], [{ copy: good, start: 30, title: 'Made-up words' }]);
    const bundle = compile(timeline, memoryReader({ [good.files[0]!.sha256]: html }, '/x/asset'));
    const index = bundle.files['index.html'] ?? '';
    expect(index).toContain('Made-up words');
    expect(bundle.links[`ws/${PNG_SHA}.png`]).toEqual({ source: '/x/asset', key: PNG_SHA });
    expect(bundle.files['tc.css']).toContain(`url('ws/${PNG_SHA}.png')`);
  });

  it('leaves them out, with a warning, without a workspace or when a blob is missing', async () => {
    const html = await headline();
    const good = copyOf(html);
    const timeline = withGraphics([good], [{ copy: good, start: 30 }]);
    for (const workspace of [undefined, memoryReader({}), memoryReader({ [good.files[0]!.sha256]: html })]) {
      const bundle = compile(timeline, workspace);
      expect(bundle.files['index.html']).not.toContain('tc-comp');
      expect(bundle.warnings.some((note) => note.includes('workspace'))).toBe(true);
    }
  });

  it('reads blobs from the project’s folder and tells an image by its bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'taalcut-ws-'));
    const text = 'made-up text';
    for (const [hash, bytes] of [
      [sha(text), text],
      [PNG_SHA, PNG],
    ] as const) {
      const file = join(root, workspaceBlobPath(PROJECT, hash));
      await mkdir(join(file, '..'), { recursive: true });
      await writeFile(file, bytes);
    }
    const reader = workspaceReaderAt(root, PROJECT);
    expect(reader.text(sha(text))).toBe(text);
    expect(reader.asset(PNG_SHA)).toEqual({
      file: join(root, workspaceBlobPath(PROJECT, PNG_SHA)),
      ext: 'png',
    });
    expect(reader.asset(sha(text))).toBeUndefined();
    expect(reader.text(sha('absent'))).toBeUndefined();
    expect(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('svg');
  });
});
