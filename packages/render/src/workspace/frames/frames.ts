// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A composition's stills (HFW1 "hf: frames", core `workspaceFrames`): the workspace's files gated as
 * `workspace.lint` gates them, folded into one stills' timeline over grey, a given picture or the footage
 * (scene.ts), compiled as the export compiles and drawn in the export's own capture session, offline. Each still
 * says where the composition's drawn content sits (content-probe.ts); the frames are drawn again in a shuffled
 * order to check seeks land on the same picture (determinism.ts), and the checks (frame-checks.ts) say what to fix.
 * At most 12 stills and 60 s a call; JPEGs no larger than `maxDimension`.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  err,
  ok,
  RationalTime,
  ValidationError,
  workspaceFramesInputSchema,
  type AsyncResult,
  type CompositionGateCheck,
  type WorkspaceFrame,
  type WorkspaceFramesInput,
  type WorkspaceFramesOutput,
} from '@taalcut/core';
import { runFfmpeg } from '@taalcut/media';
import { createCompositionFonts } from '../../captions/fonts';
import { compileComposition } from '../../compile/composition';
import { writeBundle } from '../../engine/bundle-writer';
import { openCaptureSession } from '../../engine/capture';
import type { RenderEngineDeps } from '../../engine/deps';
import { seekDeterminism, STATE_PROBE, type DrawnFrame } from './determinism';
import { presetFor } from '../../presets/presets.v1';
import { placementsOf } from '../fold/placements';
import { workspaceReaderAt } from '../fold/reader';
import { gateComposition } from '../gate/workspace-gate';
import { CONTENT_PROBE, lineCount, typeOf, type ProbedContent } from './content-probe';
import {
  attachPageDiagnostics,
  RUNTIME_ERRORS_PROBE,
  runtimeErrorsCheck,
  type PageDiagnostics,
} from './cdp-telemetry';
import { frameChecks } from './frame-checks';
import { backdropsFor, FRAMES_RATE, sceneTimeline } from './scene';

const GPU = process.platform === 'darwin' ? 'hardware' : 'software';
const BUDGET_MS = 60_000;
const ITEM = 'FRAMES';

type Deps = Pick<
  RenderEngineDeps,
  'media' | 'shell' | 'fontsDir' | 'measurer' | 'folders' | 'timelines' | 'assets' | 'workspaceRoot'
>;

const refused = (detail: string) =>
  err(ValidationError({ field: 'input' }, { detail: detail.slice(0, 500) }));

function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  let seed = 0x2545f491;
  for (let index = out.length - 1; index > 0; index--) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const other = seed % (index + 1);
    [out[index], out[other]] = [out[other]!, out[index]!];
  }
  return out;
}

/** A JPEG scaled to fit `max` on its longer side. */
async function fitted(deps: Deps, jpeg: Buffer, dir: string, index: number, max: number) {
  const input = join(dir, `still-${index}.jpg`);
  const output = join(dir, `still-${index}-fit.jpg`);
  await writeFile(input, jpeg);
  const scale = `scale='if(gt(iw,ih),min(${max},iw),-2)':'if(gt(iw,ih),-2,min(${max},ih))'`;
  const run = await runFfmpeg(deps.media, ['-y', '-i', input, '-vf', scale, '-q:v', '3', output], {
    holdsVideoSession: false,
    timeoutMs: 20_000,
  });
  if (!run.ok) return run;
  return ok(await readFile(output));
}

export async function workspaceFramesOn(
  deps: Deps,
  raw: WorkspaceFramesInput,
): AsyncResult<WorkspaceFramesOutput> {
  const started = Date.now();
  const parsed = workspaceFramesInputSchema.safeParse(raw);
  if (!parsed.success) return refused(parsed.error.message);
  const input = parsed.data;
  if (!deps.workspaceRoot) return refused('the workspace is not readable here');
  const reader = workspaceReaderAt(deps.workspaceRoot, input.projectId);
  const entry = input.files.find((file) => file.path === input.entry);
  const text = entry ? reader.text(entry.sha256) : undefined;
  if (!entry || text === undefined) return refused(`${input.entry} is not in the workspace`);
  const files = input.files.map((file) => (file === entry ? { ...file, text } : file));
  const gated = await gateComposition({ entry: input.entry, files });
  if (!gated.gate.passed || !gated.prepared) {
    const first = gated.findings.find((finding) => finding.severity === 'error');
    return refused(
      `the composition does not pass the gate: ${first?.message ?? '?'}. ${first?.fixHint ?? ''}`,
    );
  }
  const duration = Math.round(gated.prepared.doc.durationSeconds * 30);
  const frames = input.seconds.map((seconds) => Math.min(duration - 1, Math.round(seconds * 30)));
  const shell = await deps.shell();
  if (!shell.ok) return shell;
  const dir = join(deps.folders.work, 'workspace-frames', randomUUID());
  await mkdir(dir, { recursive: true });
  try {
    const backdrops = await backdropsFor(deps, input.over, frames, dir);
    if (!backdrops.ok) return backdrops;
    const { timeline, pictures } = sceneTimeline(backdrops.value, duration);
    const warnings: string[] = [];
    const [placement] = placementsOf(
      [
        {
          itemId: ITEM,
          span: { start: 0, end: duration },
          composition: { entry: input.entry, files: input.files },
          values: input.params ?? {},
        },
      ],
      reader,
      (note) => warnings.push(note),
    );
    if (!placement) return refused(warnings[0] ?? 'the composition could not be read');
    const fonts = createCompositionFonts(deps.fontsDir, await deps.measurer());
    const compiled = compileComposition(timeline, {
      variant: 'export',
      preset: presetFor('device'),
      burnCaptions: false,
      fonts,
      media: (visual) => {
        const picture = pictures.get(visual.id);
        return picture
          ? {
              file: picture.file,
              key: `frames:${visual.id}`,
              mediaStart: RationalTime.zero(FRAMES_RATE),
              ext: picture.ext,
            }
          : undefined;
      },
      compositions: [placement],
    });
    if (!compiled.ok) return compiled;
    const bundle = join(dir, 'bundle');
    await writeBundle(compiled.value, bundle);
    const blocked: string[] = [];
    let diagnostics: PageDiagnostics = attachPageDiagnostics(null);
    const session = await openCaptureSession({
      offline: { blocked },
      onPage: (page) => {
        diagnostics = attachPageDiagnostics(page);
      },
      dir: bundle,
      rate: FRAMES_RATE,
      width: 1080,
      height: 1920,
      chromePath: shell.value,
      browserGpu: GPU,
      binaries: deps.media.binaries,
    });
    if (!session.ok) return session;
    const handle = session.value;
    const out: WorkspaceFrame[] = [];
    const contents: (ProbedContent | null)[] = [];
    const inOrder = new Map<number, DrawnFrame>();
    const again = new Map<number, DrawnFrame>();
    const rawStills: { index: number; jpeg: Buffer; content: ProbedContent | null }[] = [];
    const contentByFrame = new Map<number, ProbedContent | null>();
    try {
      for (const [index, frame] of frames.entries()) {
        if (Date.now() - started > BUDGET_MS) return refused('the stills took longer than 60 s');
        const existing = inOrder.get(frame);
        if (existing) {
          const content = contentByFrame.get(frame) ?? null;
          contents.push(content);
          rawStills.push({ index, jpeg: existing.jpeg, content });
          continue;
        }
        const shot = await handle.screenshot(frame);
        if (!shot.ok) return shot;
        const probed = await handle.evaluateAt(frame, CONTENT_PROBE);
        if (!probed.ok) return probed;
        const content = (probed.value as ProbedContent[]).find((entry) => entry.id === ITEM) ?? null;
        contentByFrame.set(frame, content);
        contents.push(content);
        const state = await handle.evaluateAt(frame, STATE_PROBE);
        inOrder.set(frame, { jpeg: shot.value, state: state.ok ? String(state.value) : 'unreadable' });
        rawStills.push({ index, jpeg: shot.value, content });
      }
      const uniqueFrames = [...new Set(frames)];
      let lastFrame = frames[frames.length - 1];
      if (uniqueFrames.length <= 1) {
        for (const [frame, drawn] of inOrder) again.set(frame, drawn);
      } else {
        for (const frame of shuffled(uniqueFrames)) {
          if (Date.now() - started > BUDGET_MS) return refused('the stills took longer than 60 s');
          const shot = await handle.screenshot(frame);
          if (!shot.ok) return shot;
          const state = await handle.evaluateAt(frame, STATE_PROBE);
          again.set(frame, { jpeg: shot.value, state: state.ok ? String(state.value) : 'unreadable' });
          lastFrame = frame;
        }
      }
      if (lastFrame !== undefined) {
        const webglErrs = await handle.evaluateAt(lastFrame, RUNTIME_ERRORS_PROBE);
        if (webglErrs.ok && Array.isArray(webglErrs.value)) {
          diagnostics.recordWebglErrors(webglErrs.value.map(String));
        }
      }
    } finally {
      await handle.close();
    }
    const scaled = await Promise.all(
      rawStills.map(({ index, jpeg }) => fitted(deps, jpeg, dir, index, input.maxDimension)),
    );
    for (const [index, small] of scaled.entries()) {
      if (!small.ok) return small;
      const content = rawStills[index]!.content;
      const box = content?.box;
      const type = typeOf(content);
      out.push({
        seconds: input.seconds[index] ?? 0,
        mimeType: 'image/jpeg',
        dataBase64: small.value.toString('base64'),
        ...dimensions(input.maxDimension),
        box: box
          ? { x: box.x / 1080, y: box.y / 1920, width: box.width / 1080, height: box.height / 1920 }
          : null,
        lines: lineCount(content),
        ...(type ? { type } : {}),
      });
    }
    const determinism = await seekDeterminism(inOrder, again, { ctx: deps.media, dir });
    const checks: CompositionGateCheck[] = [
      ...frameChecks(contents, input.seconds, gated.prepared.fonts),
      {
        id: 'seekDeterminism',
        status: determinism.status,
        ...(determinism.detail ? { detail: determinism.detail.slice(0, 500) } : {}),
      },
      blocked.length === 0
        ? { id: 'network', status: 'pass' }
        : {
            id: 'network',
            status: 'fail',
            detail: `the page asked for ${blocked.slice(0, 3).join(', ')}`.slice(0, 500),
          },
      runtimeErrorsCheck(diagnostics),
    ];
    return ok({ frames: out, checks, ms: Date.now() - started });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A 1080×1920 still's size once fitted to `max` on its longer side (even, as the scale filter rounds). */
function dimensions(max: number): { width: number; height: number } {
  const height = Math.min(max, 1920);
  const width = Math.round((1080 * height) / 1920 / 2) * 2;
  return { width, height };
}
