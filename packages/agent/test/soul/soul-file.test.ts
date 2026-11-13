// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-B15 "persona in one versioned file": SOUL.md v1's front matter and dial table parse; a file without a
 * version or with a table that doesn't match is agent.soul_invalid; every prompt holds SOUL.md verbatim and
 * then the run's dial block, built from run.started.soul, so a dial change applies from the next run only and
 * resume and replay rebuild the same prompt.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unwrap, type SoulDials } from '@taalcut/core';
import {
  agentSkillModule,
  createAgent,
  dialBlock,
  parseSoul,
  readSoul,
  runSoul,
  skillSystemPrompt,
  systemPrompt,
  type AgentEvent,
} from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { harness, plan, registryFor, SOUL, turns } from '../support/harness';
import { clipsModule } from '../support/fixtures';

const FILE = readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'SOUL.md'), 'utf8');
const SOUL_V1 = unwrap(readSoul(FILE));

const withFront = (front: string, table = TABLE) =>
  `---\n${front}\n---\n\n# Who you are\n\nAn editor.\n\n${table}`;
const FRONT = [
  'name: test-soul',
  'version: 2.1.0  # minor bump',
  'updated: 2026-12-14',
  'dials:',
  '  tone: [playful, warm, balanced, crisp, professional]',
  "  verbosity: ['justDoIt', brief, balanced, explain, teachMe]",
].join('\n');
const rows = (dial: string, stops: readonly string[]) =>
  stops.map((s) => `| ${dial} | ${s} | ${s.toLowerCase()} | Says ${s}. |`).join('\n');
const TONES = ['playful', 'warm', 'balanced', 'crisp', 'professional'];
const VERBOSITIES = ['justDoIt', 'brief', 'balanced', 'explain', 'teachMe'];
const TABLE = [
  '# Dial stops',
  '',
  '| Dial | Stop | Name | What changes |',
  '| --- | --- | --- | --- |',
  rows('tone', TONES),
  rows('verbosity', VERBOSITIES),
  '',
  '# Language',
  '',
  'Match it.',
].join('\n');

describe('SOUL.md v1', () => {
  it('the repository file parses strictly: version, stops and what each stop says', () => {
    expect(SOUL_V1.version).toBe('1.0.0');
    expect(SOUL_V1.stops?.tone.map((s) => s.id)).toEqual(TONES);
    expect(SOUL_V1.stops?.verbosity.map((s) => s.name)).toEqual([
      'just do it',
      'brief',
      'balanced',
      'explain',
      'teach me',
    ]);
    expect(SOUL_V1.stops?.tone[4]?.says).toMatch(/no emoji, no exclamation marks/);
    expect(SOUL_V1.text).toBe(FILE.trim());
    // The lenient parse (tests, Phase 1 callers) agrees on the repository file.
    expect(parseSoul(FILE)).toEqual(SOUL_V1);
  });

  it('keeps its sections in the order the SPEC gives', () => {
    const headings = FILE.split('\n').filter((line) => line.startsWith('# '));
    expect(headings).toEqual([
      '# Who you are',
      '# How you talk',
      '# What you value',
      '# Taste rules (the user can change these)',
      '# Boundaries',
      '# Untrusted content',
      '# Dial stops',
      '# Language',
    ]);
    expect(FILE).toMatch(/You are Taalcut's editor, Taal:/);
    expect(FILE).toMatch(/End every turn cleanly and decisively/);
    expect(FILE).toMatch(/never show a real person's likeness/);
    expect(FILE).toMatch(/AI label on an export is the creator's choice/);
    expect(FILE).toMatch(/unless People is on/);
  });

  it('reads comments, quotes and CRLF line endings in the front matter', () => {
    const soul = unwrap(readSoul(withFront(FRONT).replaceAll('\n', '\r\n')));
    expect(soul.version).toBe('2.1.0');
    expect(soul.stops?.verbosity[0]).toEqual({ id: 'justDoIt', name: 'justdoit', says: 'Says justDoIt.' });
  });

  it.each([
    ['no front matter', '# Who you are\n\nAn editor.', 'frontMatter'],
    ['no version', withFront(FRONT.replace(/version: .*\n/, '')), 'frontMatter'],
    ['a version that is not semver', withFront(FRONT.replace('2.1.0', 'v2')), 'frontMatter'],
    ['four tone stops', withFront(FRONT.replace('playful, ', '')), 'frontMatter'],
    ['no dial table', withFront(FRONT, '# Language\n\nMatch it.'), 'dialTable'],
    ['a missing row', withFront(FRONT, TABLE.replace(/\| tone \| crisp .*\n/, '')), 'dialTable'],
    ['rows out of order', withFront(FRONT, TABLE.replace('| tone | playful', '| tone | warmX')), 'dialTable'],
    ['an empty cell', withFront(FRONT, TABLE.replace('Says brief.', '')), 'dialTable'],
    [
      'a short row',
      withFront(FRONT, TABLE.replace('| verbosity | brief | brief |', '| verbosity |')),
      'dialTable',
    ],
    [
      'an unknown dial',
      withFront(FRONT, TABLE.replace('| Name |', '| Name |\n| mood | x | x | y |')),
      'dialTable',
    ],
  ])('%s is agent.soul_invalid (%s)', (_name, markdown, reason) => {
    const read = readSoul(markdown);
    expect(!read.ok && read.error).toMatchObject({ code: 'agent.soul_invalid', params: { reason } });
    expect(!read.ok && read.error.detail).toBeTruthy();
  });

  it('the lenient parse still reads a bare version, without stops', () => {
    expect(parseSoul('---\nname: x\nversion: 2.3.0\n---\n\n# Soul')).toEqual({
      version: '2.3.0',
      text: '---\nname: x\nversion: 2.3.0\n---\n\n# Soul',
    });
    expect(parseSoul('# No front matter').version).toBe('unversioned');
  });
});

describe('the dial block', () => {
  it('names both stops, where they sit, and the stop lines from the file', () => {
    expect(dialBlock(SOUL_V1, { tone: 3, verbosity: 1 })).toBe(
      [
        '# Your dials now',
        'Tone: crisp (4 of 5 toward professional). Verbosity: brief (2 of 5 toward teach me).',
        `- Tone: ${SOUL_V1.stops?.tone[3]?.says}`,
        `- Verbosity: ${SOUL_V1.stops?.verbosity[1]?.says}`,
      ].join('\n'),
    );
  });

  it('is absent for a soul without a dial table, and for a run without dials', () => {
    expect(dialBlock(parseSoul('# Soul'), { tone: 2, verbosity: 1 })).toBeUndefined();
    expect(runSoul(SOUL_V1, undefined)).toEqual(SOUL_V1);
    // A run soul's own block is replaced, never stacked.
    const once = runSoul(SOUL_V1, { tone: 0, verbosity: 0 });
    expect(runSoul(once, { tone: 4, verbosity: 4 }).dialBlock).toMatch(
      /^# Your dials now\nTone: professional/,
    );
  });

  it('sits after SOUL.md and before the rules, in the main prompt and in a skill prompt', () => {
    const soul = runSoul(SOUL_V1, { tone: 4, verbosity: 0 });
    const catalogue = registryFor([clipsModule()]).catalogue();
    const main = systemPrompt(soul, catalogue);
    expect(main.startsWith(`${FILE.trim()}\n\n# Your dials now\nTone: professional`)).toBe(true);
    expect(main.indexOf('# Your dials now')).toBeLessThan(main.indexOf('# How you work in Taalcut'));
    const [skill] = agentSkillModule().skills;
    if (!skill) throw new Error('The agent module has its brief skill');
    const own = skillSystemPrompt(soul, skill, catalogue);
    expect(own.startsWith(`${FILE.trim()}\n\n# Your dials now`)).toBe(true);
    expect(own.indexOf('# Your dials now')).toBeLessThan(own.indexOf('# Working as a skill'));
  });
});

const started = (events: readonly AgentEvent[]) =>
  events.find((e): e is Extract<AgentEvent, { type: 'run.started' }> => e.type === 'run.started');

describe('dials in a run', () => {
  function dialHarness(initial: SoulDials, during?: SoulDials) {
    let current = initial;
    const script = turns(plan('Count the words'), { text: 'Done.' });
    const h = harness({
      script: (request, turn) => {
        // The user moves a dial while the run is going: this run keeps the dials it started with.
        if (during) current = during;
        return script(request, turn);
      },
      deps: { soul: SOUL_V1, phase3: { soulDials: async () => current } },
    });
    return { h, set: (dials: SoulDials) => (current = dials) };
  }

  it('logs the dials in run.started and builds every turn of the run from them', async () => {
    const { h } = dialHarness({ tone: 0, verbosity: 4 }, { tone: 4, verbosity: 0 });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'Count the words in clip 1.' }));
    expect(outcome.status).toBe('completed');
    expect(started(await h.events(outcome.runId))?.payload.soul).toEqual({
      version: '1.0.0',
      dials: { tone: 0, verbosity: 4 },
    });
    const systems = h.models.requests.map((r) => r.system);
    expect(systems.length).toBeGreaterThan(1);
    expect(new Set(systems).size).toBe(1);
    expect(systems[0]).toContain('Tone: playful (1 of 5 toward professional). Verbosity: teach me');
  });

  it('applies a dial change from the next run only', async () => {
    const { h, set } = dialHarness({ tone: 2, verbosity: 1 });
    unwrap(await h.agent.run({ conversationId: 'c', message: 'first' }));
    const firstCount = h.models.requests.length;
    set({ tone: 4, verbosity: 0 });
    unwrap(await h.agent.run({ conversationId: 'c', message: 'second' }));
    expect(h.models.requests[0]?.system).toContain('Tone: balanced (3 of 5');
    expect(h.models.requests[firstCount]?.system).toContain('Tone: professional (5 of 5');
  });

  it('a resumed run and a replay rebuild the logged prompt, whatever the dials say now', async () => {
    const { h, set } = dialHarness({ tone: 1, verbosity: 2 });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'Count the words in clip 1.' }));
    set({ tone: 4, verbosity: 4 });
    const report = unwrap(await h.agent.replay(outcome.runId));
    expect(report.promptDrift).toBe(0);
    expect(report.status).toBe('completed');

    // A fresh agent over the same log (a restart) uses run.started's dials.
    const again = createAgent({
      models: h.models,
      tools: h.registry,
      log: h.store,
      soul: SOUL_V1,
      phase3: { soulDials: async () => ({ tone: 4, verbosity: 4 }) },
    });
    expect(unwrap(await again.replay(outcome.runId)).promptDrift).toBe(0);
  });

  it('without the dials port a run is Phase 2: no soul in run.started, no block', async () => {
    const h = harness({ script: () => ({ text: 'Hi.' }) });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'hi' }));
    expect(started(await h.events(outcome.runId))?.payload.soul).toBeUndefined();
    expect(h.models.requests[0]?.system?.startsWith(`${SOUL.text}\n\n# How you work in Taalcut`)).toBe(true);
  });
});
