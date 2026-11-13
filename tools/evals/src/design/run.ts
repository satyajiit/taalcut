// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One design case, run and judged (HFW1 dsn): a fresh world, the Designer loop with the Designer's own prompt
 * (designer/1) and tools on the step's input, then what it left: a placed proposal (new) or a replaced design
 * (redesign) the Designer's check accepted at handoff; the composition gated again from its stored files (a
 * composition that fails now escaped the gate); its last render's frame checks; the words it carries; the comment
 * answered. Also how many renders it made, and every refusal's code (the tools' and the gate's findings).
 */
import {
  type GraphicComposition,
  type GraphicItem,
  type ProjectId,
  type Timeline,
} from '@taalcut/core';
import {
  DESIGNER_PROMPT,
  gateComposition,
  runDesignerLoop,
  type DesignerLoopResult,
  type DesignerModel,
} from '@taalcut/render';
import { LAST_TURN_NOTE, MAX_TEXT_TURNS, textTurnNote } from '@taalcut/agent';
import type { DesignCase } from './cases';
import type { DesignWorld } from './world';

export interface CaseOutcome {
  readonly id: string;
  readonly request: string;
  readonly kind: 'new' | 'redesign';
  readonly pass: boolean;
  /** Why it failed, in words; null when it passed. */
  readonly why: string | null;
  readonly placed: boolean;
  readonly gatePassed: boolean;
  readonly gateEscape: boolean;
  readonly failedChecks: readonly string[];
  readonly renders: number;
  readonly turns: number;
  readonly ms: number;
  readonly refusals: readonly string[];
  readonly stopped: DesignerLoopResult['stopped'];
  /** The last render's stills of the design that went in, as artifact ids in the world's store. */
  readonly stills: readonly string[];
  readonly reply: string;
  /** Every call in order: its tool and how it went (a refusal's code and the start of what it said). */
  readonly calls: readonly {
    readonly name: string;
    readonly ok: boolean;
    readonly code?: string;
    readonly detail?: string;
    /** A lint that didn't pass: its findings' codes, and its first error in words (what the model was told). */
    readonly findings?: readonly string[];
    readonly first?: string;
  }[];
  /** The script of the last file the model wrote (up to 1,500 characters), to see what it kept getting wrong. */
  readonly lastScript?: string;
  /** That file's markup, its style and script left out (up to 1,500 characters): what its selectors could match. */
  readonly lastMarkup?: string;
}

const graphicsOf = (timeline: Timeline) =>
  timeline.tracks.flatMap((track) =>
    track.kind === 'text' ? track.items.filter((item): item is GraphicItem => item.type === 'graphic') : [],
  );

/** The composition a graphic draws now: the timeline's newest copy with its hash. */
const copyOf = (timeline: Timeline, item: GraphicItem): GraphicComposition | undefined =>
  (timeline.graphicCompositions ?? []).find(
    (copy) => copy.id === item.composition.id && copy.hash === item.composition.hash,
  );

/** The gate again, over the files the timeline names, read from the store. */
async function regate(world: DesignWorld, composition: GraphicComposition): Promise<boolean> {
  const files = [];
  for (const file of composition.files) {
    const data = await world.store.readBlob(world.projectId as ProjectId, file.sha256);
    if (!data.ok) return false;
    files.push({ ...file, text: new TextDecoder().decode(data.value) });
  }
  const result = await gateComposition({ entry: composition.entry, files });
  return result.gate.passed;
}

/** The codes a lint's (or a render's gate's) findings name when it didn't pass. */
function findingCodes(output: unknown): string[] {
  const result = output as { passed?: boolean; findings?: { code?: string }[] } | undefined;
  return result?.passed === false ? (result.findings ?? []).flatMap((finding) => (finding.code ? [finding.code] : [])) : [];
}

/** A lint (or a render's gate) that didn't pass: its first finding, with its fix hint. */
function firstFinding(output: unknown): string | undefined {
  const result = output as { passed?: boolean; findings?: { code?: string; message?: string; fixHint?: string }[] } | undefined;
  const finding = result?.passed === false ? result.findings?.[0] : undefined;
  return finding ? `${finding.code}: ${finding.message ?? ''} ${finding.fixHint ?? ''}`.slice(0, 300) : undefined;
}

/** The script of the newest file written, from a write's text or a patch's (the patch only says what it changed). */
function lastScriptOf(loop: DesignerLoopResult): string | undefined {
  const written = [...loop.calls].reverse().find((call) => call.name === 'workspace.write');
  const text = (written?.input as { text?: unknown } | undefined)?.text;
  if (typeof text !== 'string') return undefined;
  const script = /<script[^>]*>([\s\S]*?)<\/script>/.exec(text)?.[1] ?? text;
  return script.trim().slice(0, 1500);
}

/** The markup of the newest file written: its template without style or script, on one line. */
function lastMarkupOf(loop: DesignerLoopResult): string | undefined {
  const written = [...loop.calls].reverse().find((call) => call.name === 'workspace.write');
  const text = (written?.input as { text?: unknown } | undefined)?.text;
  if (typeof text !== 'string') return undefined;
  const template = /<template[^>]*>([\s\S]*?)<\/template>/.exec(text)?.[1] ?? text;
  return template
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1500);
}

/** The codes a call's refusal or a lint's findings name. */
function refusalCodes(loop: DesignerLoopResult): string[] {
  return loop.calls.flatMap((call) => [...(!call.ok && call.code ? [call.code] : []), ...findingCodes(call.output)]);
}

export async function runDesignCase(
  entry: DesignCase,
  world: DesignWorld,
  model: DesignerModel,
): Promise<CaseOutcome> {
  const started = Date.now();
  const loop = await runDesignerLoop({
    model,
    tools: world.tools,
    system: DESIGNER_PROMPT,
    task: [{ type: 'text', text: world.task }],
    dispatch: world.dispatch,
    artifacts: world.artifacts,
    runId: `eval-${entry.id}`,
    // As the agent runs the Designer's step: words alone get a nudge (three in a row end it), and the last turn
    // offers only handOff (agent turn-context.ts).
    words: {
      turns: MAX_TEXT_TURNS,
      note: textTurnNote(world.tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.input }))),
    },
    lastTurn: { tools: ['handOff'], note: LAST_TURN_NOTE },
    // An accepted handOff ends the step, as it does in an agent run (it went on calling it to the 30th turn).
    endsWith: (call) => call.name === 'handOff' && call.ok,
  });
  const timeline = world.timeline();
  const kind = entry.before ? 'redesign' : 'new';
  const accepted = world.handoffs.at(-1);
  const result = accepted?.results[0];
  const graphics = graphicsOf(timeline);
  const target =
    kind === 'redesign'
      ? graphics.find((item) => world.before?.itemIds.includes(item.id))
      : graphics.find((item) => result?.itemIds?.includes(item.id) && item.proposal);
  const copy = target ? copyOf(timeline, target) : undefined;
  const placed =
    kind === 'redesign'
      ? result?.outcome === 'replaced' && copy !== undefined && copy.version > 1
      : result?.outcome === 'placed' && copy !== undefined;
  const gatePassed = copy?.gate.passed ?? false;
  const gateEscape = copy !== undefined && !(await regate(world, copy));
  // The design's last render: the newest workspace.render or renderOver of its entry that drew.
  const renders = loop.calls.filter((call) => (call.name === 'workspace.render' || call.name === 'workspace.renderOver') && call.ok);
  const last = [...renders]
    .reverse()
    .find((call) => (call.output as { entry?: string } | undefined)?.entry === copy?.entry) as
    | { output: { checks: { id: string; status: string }[]; frames: { image: { id: string } }[] } }
    | undefined;
  const failedChecks = (last?.output.checks ?? []).filter((check) => check.status === 'fail').map((check) => check.id);
  const values = [
    ...Object.values(target?.composition.params ?? {}),
    ...(copy?.variables ?? []).map((variable) => ('sample' in variable ? variable.sample : '')),
  ]
    .join(' ')
    .toLowerCase();
  const missing = entry.words.filter((word) => !values.includes(word.toLowerCase()));
  const replied = !entry.comment || world.replies.length > 0;
  const why = !accepted
    ? `no accepted handoff (${loop.stopped}${loop.error ? `: ${loop.error.code}${loop.error.detail ? `: ${loop.error.detail.slice(0, 400)}` : ''}` : ''})`
    : !placed
      ? `${result?.outcome ?? 'no result'}${result?.reason ? `: ${result.reason}` : ''}`
      : !gatePassed || gateEscape
        ? 'its composition does not pass the gate'
        : failedChecks.length > 0
          ? `frame checks failed: ${failedChecks.join(', ')}`
          : !last
            ? 'never rendered the design that went in'
            : missing.length > 0
              ? `missing words: ${missing.join(', ')}`
              : !replied
                ? 'the comment was not answered'
                : null;
  return {
    id: entry.id,
    request: entry.request,
    kind,
    pass: why === null,
    why,
    placed,
    gatePassed,
    gateEscape,
    failedChecks,
    renders: renders.length,
    turns: loop.turns,
    ms: Date.now() - started,
    refusals: refusalCodes(loop),
    stopped: loop.stopped,
    stills: (last?.output.frames ?? []).map((frame) => frame.image.id),
    reply: loop.text.slice(0, 300),
    calls: loop.calls.map((call) => ({
      name: call.name,
      ok: call.ok,
      ...(call.code ? { code: call.code } : {}),
      ...(call.detail ? { detail: call.detail.slice(0, 200) } : {}),
      ...(findingCodes(call.output).length ? { findings: [...new Set(findingCodes(call.output))] } : {}),
      ...(firstFinding(call.output) ? { first: firstFinding(call.output) } : {}),
    })),
    ...(lastScriptOf(loop) ? { lastScript: lastScriptOf(loop) } : {}),
    ...(lastMarkupOf(loop) ? { lastMarkup: lastMarkupOf(loop) } : {}),
  };
}
