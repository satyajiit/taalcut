// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as siteActs from '#components/kaatu/kaatu-acts';
import { APP_SHEETS, SHEETS, WEB_SHEETS, facing, locate, turnPath, type KaatuDirection, type KaatuFrame } from '#components/kaatu/kaatu-frames';
import { KAATU_MOODS, moodScript } from '#components/kaatu/kaatu-moods';
import { MOVES, WEB_MOVES } from '#components/kaatu/kaatu-moves';
import { REPO_ROOT } from './source-files';

/**
 * Kaatu on the site is the app's Kaatu: the app's own files are read as text, compiled and run here (the site never
 * imports them), and the site's frame map, acts and moves must match them. The site's two extra sheets come after
 * the app's six and never rename one of its frames.
 */
type Module = Record<string, unknown>;

function evaluate(path: string, deps: Record<string, Module>): Module {
  const source = readFileSync(join(REPO_ROOT, path), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false },
  });
  const exports: Module = {};
  const require = (id: string): Module => {
    if (id.endsWith('.webp')) return { default: id };
    const dep = deps[id];
    if (!dep) throw new Error(`${path} needs ${id}, which the parity test doesn't provide`);
    return dep;
  };
  new Function('exports', 'require', outputText)(exports, require);
  return exports;
}

const appFrames = evaluate('packages/ui/src/brand/kaatu-frames.ts', {});
const appActs = evaluate('packages/ui/src/brand/kaatu-acts.ts', { './kaatu-frames': appFrames });
const appMovesSource = readFileSync(join(REPO_ROOT, 'packages/ui/src/brand/kaatu-moves.ts'), 'utf8');

const APP: KaatuFrame[] = APP_SHEETS.flat();
const DIRECTIONS = APP_SHEETS[0] as readonly KaatuDirection[];

describe('Kaatu’s frames match the app’s', () => {
  it('has the app’s 54 frames in the same cells, then the site’s 18', () => {
    const appSheets = /const SHEETS = \[([\s\S]*?)\] as const;/.exec(readFileSync(join(REPO_ROOT, 'packages/ui/src/brand/kaatu-frames.ts'), 'utf8'));
    const names = [...(appSheets?.[1] ?? '').matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
    expect(names).toEqual(APP);
    const appLocate = appFrames.locate as (f: string) => unknown;
    for (const frame of APP) expect(locate(frame), frame).toEqual(appLocate(frame));
    expect(SHEETS.slice(0, 6)).toEqual(APP_SHEETS);
    const web: KaatuFrame[] = WEB_SHEETS.flat();
    expect(web).toHaveLength(18);
    for (const frame of web) expect(APP, frame).not.toContain(frame);
    expect(new Set(SHEETS.flat()).size).toBe(72);
  });

  it('turns the head the same way', () => {
    const appFacing = appFrames.facing as (f: string) => string;
    const appTurn = appFrames.turnPath as (a: string, b: string) => string[];
    for (const frame of APP) expect(facing(frame), frame).toBe(appFacing(frame));
    for (const a of DIRECTIONS) for (const b of DIRECTIONS) expect(turnPath(a, b), `${a}→${b}`).toEqual(appTurn(a, b));
  });
});

describe('Kaatu’s acts match the app’s', () => {
  it('plays the same clips at the same timings', () => {
    expect(siteActs.TURN_MS).toBe(appActs.TURN_MS);
    expect(siteActs.THINKING).toEqual(appActs.THINKING);
    for (const name of ['DOZE', 'WAKE', 'SHY', 'DIZZY', 'POKES', 'CALM_POKES'] as const) expect(siteActs[name], name).toEqual(appActs[name]);
    const appAntics = appActs.ANTICS as Record<string, unknown>;
    expect(Object.keys(siteActs.ANTICS).sort()).toEqual(Object.keys(appAntics).sort());
    for (const [name, clip] of Object.entries(siteActs.ANTICS)) expect(clip, name).toEqual(appAntics[name]);
  });

  it('blinks the same way wherever it looks', () => {
    const appBlink = appActs.blinkClip as (d: string, smooth: boolean, double: boolean) => unknown;
    for (const d of DIRECTIONS)
      for (const smooth of [true, false])
        for (const double of [true, false]) expect(siteActs.blinkClip(d, smooth, double)).toEqual(appBlink(d, smooth, double));
  });

  it('moves the body the same way, and the site’s own moves never reuse an app move’s name', () => {
    const appNames = [...appMovesSource.matchAll(/^ {2}'?([a-z-]+)'?: \{\s*ms: (\d+),/gm)].map((m) => [m[1], Number(m[2])]);
    expect(Object.keys(MOVES).sort()).toEqual(appNames.map(([name]) => name).sort());
    for (const [name, ms] of appNames) expect(MOVES[name as keyof typeof MOVES].ms, String(name)).toBe(ms);
    for (const name of Object.keys(WEB_MOVES)) expect(Object.keys(MOVES), name).not.toContain(name);
  });
});

describe('the site’s moods', () => {
  it('use only drawn frames and hold one still frame each', () => {
    const all: KaatuFrame[] = SHEETS.flat();
    for (const mood of KAATU_MOODS) {
      const s = moodScript(mood);
      for (const f of [s.home, s.still, ...(s.opening ?? []).map((b) => b.frame)]) expect(all, `${mood}: ${f}`).toContain(f);
    }
  });

  it('wave ends at idle and asleep breathes slower', () => {
    expect(moodScript('wave').life).toBe('idle');
    expect(moodScript('asleep').breath).toBe('asleep');
    expect(moodScript('glance', 'left').home).toBe('left');
  });
});
