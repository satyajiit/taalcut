// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-X1: `audio.cloudCritique` in the agent process. It joins the `audio` module, is never offered on MCP, and runs
 * only for a call whose consent card the person answered "Allow" in the run's log: a call that was never asked, was
 * refused, was answered at once (Local only, or any standing consent: EAR1-R3, the tool asks every time), or has no
 * run gets `audio.cloud_critique_consent_required`. EAR1-R3: the card names the sound, never by a path.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fromCoreEventLog, newEvent } from '@taalcut/agent';
import {
  createContainer,
  createMemoryEventLogStore,
  newId,
  ok,
  TemplateStoreToken,
  unwrap,
  type Container,
  type EventLogStore,
  type TemplateStore,
} from '@taalcut/core';
import { createAssetRepository, type LibraryPorts } from '@taalcut/library';
import { createMemoryArtifactStore } from '@taalcut/tools';
import { LibraryDatabaseToken, LibraryPortsToken } from '../src/shared/tokens';
import { withAudioTools } from '../src/utility/roots/agent-audio';
import { cardName, critiqueUploadNames, runLogConsent } from '../src/utility/roots/agent-listen-cloud';
import { testAgent, testConfig } from './helpers/roots';

const open: Container[] = [];
afterEach(async () => {
  for (const container of open.splice(0)) await container.dispose();
});

const UPLOAD = { modules: ['vision'], providers: ['google'], files: [] };

async function logWith(
  store: EventLogStore,
  runId: ReturnType<typeof newId<'AgentRun'>>,
  events: ReturnType<typeof newEvent>[],
) {
  const appended = await fromCoreEventLog(store).append(runId, 0, events);
  if (!appended.ok) throw new Error(appended.error.code);
}

describe('audio.cloudCritique in the agent process', () => {
  it('joins the audio module, after its other tools, and is never on MCP', () => {
    const { container } = testAgent(testConfig('agent'));
    open.push(container);
    const audio = withAudioTools(container, []).find((module) => module.id === 'audio');
    const names = audio?.tools.map((tool) => tool.name) ?? [];
    expect(names.at(-1)).toBe('audio.cloudCritique');
    const tool = audio?.tools.find((t) => t.name === 'audio.cloudCritique');
    expect(tool).toMatchObject({ sideEffect: 'external', alwaysAsk: true, exposure: { mcp: false } });
  });
});

describe('the consent check', () => {
  const callId = newId<'ToolRun'>();
  const runId = newId<'AgentRun'>();
  const at = 1_700_000_000_000;
  const asked = (requestId: string, extra: object = {}) =>
    newEvent(
      'approval.requested',
      { requestId, kind: 'consent', toolCallIds: [callId], reason: 'upload', upload: UPLOAD, ...extra },
      at,
    );

  it('passes a call the person allowed on its card', async () => {
    const store = createMemoryEventLogStore();
    await logWith(store, runId, [
      asked('r1', { upload: { ...UPLOAD, media: 'audio' }, alwaysAsk: true }),
      newEvent('approval.granted', { requestId: 'r1' }, at + 1),
    ]);
    expect(await runLogConsent(() => store).check({ callId, runId })).toEqual({ ok: true, value: undefined });
  });

  const granted = (extra: object) => [
    asked('r1', extra),
    newEvent('approval.granted', { requestId: 'r1' }, at + 1),
  ];

  it.each([
    ['never asked', []],
    ['asked, not answered', [asked('r1')]],
    ['refused', [asked('r1'), newEvent('approval.denied', { requestId: 'r1' }, at + 1)]],
    [
      'answered by Local only',
      [asked('r1', { localOnly: true }), newEvent('approval.granted', { requestId: 'r1' }, at + 1)],
    ],
    // EAR1-I5: an "Always allow" given for vision's frames is no consent to send sound.
    ['answered by a standing consent for frames', granted({ standingConsentIds: ['c1'] })],
    // EAR1-R3: nor is one given for sound: the tool asks every time.
    [
      'answered by a standing consent for sound',
      granted({ standingConsentIds: ['c1'], upload: { ...UPLOAD, media: 'audio' } }),
    ],
    ['answered by the reference rule', granted({ reference: true })],
    [
      'granted for another call',
      [
        newEvent(
          'approval.requested',
          {
            requestId: 'r2',
            kind: 'consent',
            toolCallIds: [newId<'ToolRun'>()],
            reason: 'upload',
            upload: UPLOAD,
          },
          at,
        ),
        newEvent('approval.granted', { requestId: 'r2' }, at + 1),
      ],
    ],
  ] as const)('refuses a call %s', async (_name, events) => {
    const store = createMemoryEventLogStore();
    if (events.length > 0) await logWith(store, runId, [...events]);
    expect(await runLogConsent(() => store).check({ callId, runId })).toMatchObject({
      ok: false,
      error: { code: 'audio.cloud_critique_consent_required' },
    });
  });

  it('refuses a call outside an agent run', async () => {
    const store = createMemoryEventLogStore();
    for (const check of [
      runLogConsent(() => store).check({ callId }),
      runLogConsent(() => undefined).check({ callId, runId }),
    ])
      expect(await check).toMatchObject({
        ok: false,
        error: { code: 'audio.cloud_critique_consent_required' },
      });
  });
});

describe('the sound’s name on its consent card (EAR1-R3)', () => {
  const tool = 'audio.cloudCritique';

  it.each([
    ['Voice memo 14.m4a', 'Voice memo 14.m4a'],
    ['Before/After', 'Before\u2215After'],
    ['Mixed sound of /Users/asha/Movies/trip.mov, 32 s.', 'Mixed sound of trip.mov, 32 s.'],
    ['C:\\Users\\asha\\memo.m4a', 'memo.m4a'],
    ['scratch/listen/artifact.wav', 'artifact.wav'],
    [`  Two\n lines  `, 'Two lines'],
    ['a'.repeat(100), `${'a'.repeat(79)}…`],
  ])('shows %j as %j', (text, shown) => {
    expect(cardName(text)).toBe(shown);
  });

  it('names an asset by its file name, an artifact by its label and a template’s reel by its name', async () => {
    const { container } = testAgent(testConfig('agent'));
    open.push(container);
    const names = critiqueUploadNames(container);
    const db = container.resolve(LibraryDatabaseToken);
    const asset = unwrap(
      createAssetRepository(db).create({
        kind: 'audio',
        sizeBytes: 10,
        originalFilename: 'Voice memo 14.m4a',
      }),
    );
    expect(await names({ tool, input: { assetId: asset.id } })).toEqual(['Voice memo 14.m4a']);

    const artifacts = createMemoryArtifactStore();
    const templates = { get: async () => ok({ summary: { name: 'Goa/Trip' } }) } as unknown as TemplateStore;
    const stores = createContainer()
      .value(LibraryPortsToken, { artifacts } as unknown as LibraryPorts)
      .value(TemplateStoreToken, templates);
    const artifact = unwrap(
      await artifacts.put({
        mediaType: 'audio/wav',
        data: new Uint8Array(8),
        summary: 'Procedural whoosh SFX (450 ms). Peak at 200 ms.',
      }),
    );
    const named = critiqueUploadNames(stores);
    expect(await named({ tool, input: { artifactId: artifact.id } })).toEqual([
      'Procedural whoosh SFX (450 ms).',
    ]);
    expect(await named({ tool, input: { templateId: newId<'Template'>() } })).toEqual(['Goa\u2215Trip']);
    // Nothing for a source that isn't there (the tool then fails on its own), a bad id, or another tool.
    expect(await names({ tool, input: { assetId: newId<'Asset'>() } })).toEqual([]);
    expect(await names({ tool, input: { assetId: 'not-an-id' } })).toEqual([]);
    expect(await names({ tool: 'vision.describeFrame', input: { assetId: asset.id } })).toEqual([]);
  });
});
