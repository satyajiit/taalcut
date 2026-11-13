// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Offline catalogue refresh of the four recorded sessions (EAR1-I1; EAR1-I1a's schema-only refresh, grown to tools
 * added to the catalogue and to a skill's list). Every response byte, interaction count and recorder timestamp stays;
 * only what each request offers, and so its match hash, moves to what the agent offers now.
 *
 * Usage, from the repo root (it needs FFmpeg, as the gate demo's test does):
 *   pnpm --filter @taalcut/gate-demo refresh:catalogue                          # dry run: reports, writes nothing
 *   pnpm --filter @taalcut/gate-demo refresh:catalogue -- --write --update=<name>
 * It exits 2, writing nothing, when the sessions changed beyond their offers: re-record them then (`rerecord`).
 *
 * With the network off here and in the runs it starts, and no model:
 * 1. the catalogue is the gate demo's composition's (test/compose.ts), which test/catalogue.test.ts and the desktop's
 *    test/agent-catalogue.test.ts hold to the desktop's agent process; no recorded tool may be gone from it;
 * 2. the gate demo's session (plain steps, whose offer tool search ranks over the whole catalogue): its headless
 *    journey (test/gate-demo.test.ts) is recorded again with the stored responses as its only upstream
 *    (TAALCUT_RECORD_UPSTREAM=cassette) into a scratch folder; each request takes that run's tools, and must
 *    otherwise be the one recorded;
 * 3. the app's sessions (skill steps, each offered its skill's whole list): what each step's skill offers now, from
 *    the desktop's agent process (its test/agent-catalogue.test.ts with TAALCUT_REFRESH_OFFERS);
 * 4. every registry tool offered must then be the registry's description and input schema, and an unchanged tool
 *    the bytes it was recorded with;
 * 5. match hashes are recomputed by @taalcut/models' recorder with each stored response as its upstream;
 * 6. recorded calls to the added or changed tools are checked against their input schemas;
 * 7. --write writes the cassettes, the catalogues and catalogue-refresh.json.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createBinaryResolver } from '@taalcut/media';
import { disableNetwork } from '@taalcut/models';
import {
  catalogueDrift,
  catalogueOf,
  createRecordedGateModels,
  EDIT_CHAT_SESSION,
  EDIT_DESIGN_SESSION,
  GATE_DEMO_FIXTURES,
  GATE_DEMO_SESSION,
  MAKE_FLOW_SESSION,
  OFFER_META_TOOLS,
  recordedCatalogue,
  writeRecordedCatalogue,
  type RecordedSession,
} from '../src/index';
import { composeGateDemo } from '../test/compose';
import {
  checkedCalls,
  readTape,
  rebuiltOffer,
  recomputedMatches,
  registryWire,
  same,
  sha,
  withCacheMark,
  wireTool,
  type WireTool,
} from './refresh-offers';
import { alignJourney } from './refresh-journey';
import { refreshMeta } from './refresh-meta';

const SESSIONS = [GATE_DEMO_SESSION, MAKE_FLOW_SESSION, EDIT_CHAT_SESSION, EDIT_DESIGN_SESSION];
/** The sessions the gate demo's headless journey replays; the app records the others. */
const JOURNEYS: readonly RecordedSession[] = [GATE_DEMO_SESSION];
const GATE = resolve(import.meta.dirname, '..');
const DESKTOP = resolve(GATE, '..', 'desktop');

const write = process.argv.includes('--write');
const updateName = process.argv.find((arg) => arg.startsWith('--update='))?.slice('--update='.length);
const say = (line: string) => process.stdout.write(`${line}\n`);
const refusals: string[] = [];
const refuse = (why: string) => {
  refusals.push(why);
  say(`  REFUSE: ${why}`);
};

const guard = disableNetwork();
const scratch = mkdtempSync(join(tmpdir(), 'taalcut-refresh-'));

// 1. The live catalogue and the registry's tools on the wire.
mkdirSync(join(scratch, 'app-data'));
const demo = composeGateDemo({
  databasePath: join(scratch, 'library.db'),
  resolver: createBinaryResolver({ development: true }),
  home: scratch,
  appData: join(scratch, 'app-data'),
  models: createRecordedGateModels(GATE_DEMO_FIXTURES, { home: scratch, mode: 'replay' }),
});
const modules = demo.toolModules;
demo.close();
const offered = catalogueOf(modules);
const wire = registryWire(modules);
const toolOf = (line: string) => line.split(' ')[1] ?? '';
/** Tools added to the catalogue or changed in what the model sees, in any session. */
const changed = new Set<string>();
for (const session of SESSIONS) {
  const recorded = recordedCatalogue(session, GATE_DEMO_FIXTURES) ?? [];
  const drift = catalogueDrift(recorded, offered);
  say(`${session.name}: catalogue drift ${drift.length === 0 ? 'none' : `(${drift.length})`}`);
  for (const line of drift) say(`  ${line}`);
  const now = new Set(offered.map(toolOf));
  for (const line of recorded) if (!now.has(toolOf(line))) refuse(`${session.name}: ${toolOf(line)} is gone`);
  for (const line of offered) if (!recorded.includes(line)) changed.add(toolOf(line));
}
say(`catalogue: ${offered.length} tools; added or changed: ${[...changed].join(', ') || 'none'}`);

// 2–3. The runs that re-derive the offers, offline, into the scratch folder.
function run(label: string, cwd: string, args: string[], env: Record<string, string>): void {
  say(`${label}: vitest ${args.join(' ')}`);
  const ran = spawnSync(
    'pnpm',
    ['exec', 'vitest', 'run', '--fsModuleCachePath', 'node_modules/.vitest-cache', ...args],
    {
      cwd,
      env: { ...process.env, ...env },
      encoding: 'utf8',
    },
  );
  if (ran.status !== 0)
    refuse(`${label} failed:\n${`${ran.stdout}${ran.stderr}`.split('\n').slice(-40).join('\n')}`);
}
const journeys = join(scratch, 'journeys');
for (const session of JOURNEYS)
  run(`${session.name} journey`, GATE, ['test/gate-demo.test.ts', '-t', 'the recorded model session'], {
    TAALCUT_RECORD: '1',
    TAALCUT_RECORD_SESSION: session.name,
    TAALCUT_RECORD_UPSTREAM: 'cassette',
    TAALCUT_RECORD_DIR: journeys,
  });
const offers = join(scratch, 'offers');
run(
  'desktop skill and meta offers',
  DESKTOP,
  ['test/agent-catalogue.test.ts', 'test/agent-meta-catalogue.test.ts', '-t', 'skill step|meta schemas'],
  {
    TAALCUT_REFRESH_OFFERS: offers,
  },
);

// 4–6. Per session.
const refreshPath = join(GATE_DEMO_FIXTURES, 'catalogue-refresh.json');
const refresh = JSON.parse(readFileSync(refreshPath, 'utf8')) as {
  update: string;
  liveProviderCalls: number;
  note: string;
  sessions: Record<string, { recordedAt: string; interactionCount: number; responseSha256: string }>;
};
const isMeta = (name: string) => OFFER_META_TOOLS.has(name);
const outputs: [string, string][] = [];
const stats: Record<string, Record<string, unknown>> = {};

for (const session of SESSIONS) {
  const path = join(GATE_DEMO_FIXTURES, session.cassette);
  const text = readFileSync(path, 'utf8');
  const tape = readTape(path);
  if (`${JSON.stringify(tape, null, 2)}\n` !== text)
    throw new Error(`${path} does not round-trip byte for byte`);
  const before = refresh.sessions[session.name];
  if (!before) throw new Error(`catalogue-refresh.json has no ${session.name}`);
  if (tape.recordedAt !== before.recordedAt) refuse(`${session.name}: recordedAt moved`);
  if (tape.interactions.length !== before.interactionCount)
    refuse(`${session.name}: interaction count moved`);
  const responses = sha(tape.interactions.map((row) => row.response));
  if (responses !== before.responseSha256) refuse(`${session.name}: responses moved`);

  const reoffered = new Set<number>();
  const offer = (i: number, tools: WireTool[]) => {
    const body = tape.interactions[i]!.request.body!;
    if (!same(body.tools, tools)) reoffered.add(i);
    body.tools = tools;
  };
  // 2. The re-derived journey's tools, request by request.
  const derived = join(journeys, session.cassette);
  if (JOURNEYS.includes(session)) {
    const again = existsSync(derived) ? readTape(derived) : undefined;
    if (!again) refuse(`${session.name}: its journey recorded nothing (does FFmpeg run here?)`);
    else if (again.interactions.length !== tape.interactions.length)
      refuse(
        `${session.name}: the journey made ${again.interactions.length} requests, not ${tape.interactions.length}`,
      );
    else {
      try {
        const positions = alignJourney(tape.interactions, again.interactions);
        again.interactions.forEach((row, i) => {
          if (row.request.body?.tools) offer(positions[i]!, row.request.body.tools);
        });
      } catch (error) {
        refuse(`${session.name}: ${String(error)}`);
      }
    }
  }
  // 3. The skill steps' lists, from the desktop.
  const offersFile = join(offers, `${session.name}.offers.json`);
  if (existsSync(offersFile)) {
    const steps = JSON.parse(readFileSync(offersFile, 'utf8')) as Record<
      string,
      { skill: string; tools: string[] }
    >;
    for (const [index, step] of Object.entries(steps)) {
      const i = Number(index);
      const tools = tape.interactions[i]?.request.body?.tools ?? [];
      const was = tools.filter((tool) => !isMeta(tool.name)).map((tool) => tool.name);
      const dropped = was.filter((name) => !step.tools.includes(name));
      if (dropped.length > 0)
        refuse(`${session.name}#${i} ${step.skill}: no longer offers ${dropped.join(', ')}`);
      if (!same(withCacheMark(tools), tools))
        refuse(`${session.name}#${i}: the cache mark is not where pi-ai puts it`);
      offer(i, rebuiltOffer(tools, step.tools, wire, isMeta));
    }
  } else if (!JOURNEYS.includes(session)) refuse(`${session.name}: the desktop wrote no skill offers`);

  const metaFile = join(offers, `${session.name}.meta.json`);
  if (!existsSync(metaFile)) refuse(`${session.name}: the desktop wrote no actual meta offers`);
  else {
    try {
      const indices = refreshMeta(
        tape,
        JSON.parse(readFileSync(metaFile, 'utf8')) as Record<string, WireTool[]>,
      );
      for (const index of indices) reoffered.add(index);
    } catch (error) {
      refuse(`${session.name}: ${String(error)}`);
    }
  }

  // 4. Every registry tool offered is the registry's; an unchanged one, the bytes it was recorded with.
  const original = readTape(path);
  tape.interactions.forEach((row, i) => {
    const recorded = new Map(
      (original.interactions[i]!.request.body?.tools ?? []).map((tool) => [tool.name, tool]),
    );
    for (const tool of row.request.body?.tools ?? []) {
      const now = wire.get(tool.name);
      if (!now) continue;
      const { cache_control: _mark, ...rest } = tool;
      if (!same(rest, wireTool(tool.name, now)))
        refuse(`${session.name}#${i}: ${now.tool} is not the registry's`);
      const was = recorded.get(tool.name);
      if (
        was &&
        !changed.has(now.tool) &&
        !same({ ...was, cache_control: undefined }, { ...tool, cache_control: undefined })
      )
        refuse(`${session.name}#${i}: unchanged ${now.tool} would be sent differently`);
    }
  });

  // 5. Match hashes; 6. calls to the tools that changed.
  const matches = await recomputedMatches(tape, scratch, session.name);
  let updated = 0;
  tape.interactions.forEach((row, i) => {
    if (row.request.match !== matches[i]) updated += 1;
    row.request.match = matches[i]!;
  });
  if (sha(tape.interactions.map((row) => row.response)) !== before.responseSha256)
    refuse(`${session.name}: replies`);
  const calls = checkedCalls(tape, changed, wire);
  say(
    `${session.name}: ${reoffered.size} of ${tape.interactions.length} offers re-derived, ${updated} matches updated; ` +
      `${calls.valid} recorded calls to changed tools validate, ${calls.invalid.length} do not ${calls.invalid.join(' ')}`,
  );
  if (calls.invalid.length > 0) refuse(`${session.name}: recorded calls no longer validate`);
  outputs.push([path, `${JSON.stringify(tape, null, 2)}\n`]);
  stats[session.name] = {
    recordedAt: before.recordedAt,
    interactionCount: before.interactionCount,
    offersChanged: reoffered.size,
    updatedRequests: updated,
    validCalls: calls.valid,
    responseSha256: before.responseSha256,
  };
}

rmSync(scratch, { recursive: true, force: true });
guard.restore();
const liveProviderCalls = guard.blocked.length;
say(`liveProviderCalls: ${liveProviderCalls}`);
if (refusals.length > 0 || liveProviderCalls !== 0) {
  say('Not written: the sessions changed beyond what the agent offers. Re-record them.');
  process.exit(2);
}
if (changed.size === 0 && Object.values(stats).every((s) => !s.offersChanged && !s.updatedRequests)) {
  say('Nothing to refresh: every session already offers what the agent offers now.');
  process.exit(0);
}
if (!write) {
  say('Dry run: pass --write to write the fixtures.');
  process.exit(0);
}
for (const [path, text] of outputs) writeFileSync(path, text);
for (const session of SESSIONS) writeRecordedCatalogue(session, offered, GATE_DEMO_FIXTURES);
const next = {
  ...refresh,
  update: updateName ?? refresh.update,
  liveProviderCalls,
  note:
    `Offline refresh: the catalogue's ${offered.length} tools (${[...changed].join(', ') || 'none'} added or changed). ` +
    "Plain steps took the offers of the gate demo's headless journey recorded again with the stored responses as " +
    "its only upstream; skill steps took their skill's current list from the desktop's agent process. Planning, plain-step " +
    'and recorded skill meta schemas came from actual public-agent requests serialized by the provider SDK. Canonical ' +
    'request hashes were recomputed by the cassette recorder with stored responses as its only upstream. Every ' +
    'response byte, interaction count and original recorder timestamp is unchanged; no live provider was contacted.',
  sessions: stats,
};
writeFileSync(refreshPath, `${JSON.stringify(next, null, 2)}\n`);
say('Written.');
