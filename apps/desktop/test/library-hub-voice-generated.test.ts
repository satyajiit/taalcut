// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The library's Phase 3 stores by core's tokens (library-hub.ts, library-voice.ts, library-generated.ts): each
 * opens the library only when first resolved; the hub stores keep what they're given; the consent store keeps
 * the capture main finished, from main's captures folder, in its own; the sink keeps files under the originals
 * root the setting names.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createContainer,
  createEventBus,
  EventBusToken,
  GeneratedAssetSinkToken,
  HubIndexCacheToken,
  HubSubmissionStoreToken,
  newId,
  unwrap,
  VOICE_CONSENT_TERMS_VERSION,
  VoiceConsentStoreToken,
} from '@taalcut/core';
import {
  createLibraryPorts,
  createSettingsRepository,
  openDatabase,
  ORIGINALS_ROOT_SETTING,
} from '@taalcut/library';
import { afterEach, describe, expect, it } from 'vitest';
import { LibraryDatabaseToken, LibraryPortsToken } from '../src/shared/tokens';
import { voiceCapturesDir, voiceRecordingsDir } from '../src/shared/voice-consent-paths';
import { registerLibraryGenerated } from '../src/utility/roots/library-generated';
import { registerLibraryHub } from '../src/utility/roots/library-hub';
import { registerLibraryVoice } from '../src/utility/roots/library-voice';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function libraryContainer() {
  const db = unwrap(openDatabase({ path: ':memory:' }));
  let opened = 0;
  const container = createContainer()
    .value(EventBusToken, createEventBus({ clock: { now: () => 1 } }))
    .factory(LibraryDatabaseToken, () => {
      opened += 1;
      return db;
    })
    .factory(LibraryPortsToken, ({ db: library }) => createLibraryPorts(library), {
      deps: { db: LibraryDatabaseToken },
    });
  const userData = mkdtempSync(join(tmpdir(), 'taalcut-desktop-'));
  dirs.push(userData);
  return { db, container, userData, opened: () => opened };
}

describe('the library’s Phase 3 stores in the agent and jobs processes', () => {
  it('registers the hub stores lazily, and they keep what they are given', async () => {
    const env = libraryContainer();
    registerLibraryHub(env.container);
    expect(env.opened()).toBe(0);
    const cache = env.container.resolve(HubIndexCacheToken);
    unwrap(await cache.writeIndex({ etag: '"e"', fetchedAt: 3, body: { templates: [] } }));
    expect(unwrap(await cache.readIndex())).toEqual({ etag: '"e"', fetchedAt: 3, body: { templates: [] } });
    const submissions = env.container.resolve(HubSubmissionStoreToken);
    const templateId = newId<'Template'>();
    const hubId = newId<'HubTemplate'>();
    unwrap(
      await submissions.record({
        id: newId<'HubSubmission'>(),
        hubId,
        version: 1,
        templateId,
        templateVersion: 1,
        state: 'open',
        createdAt: 1,
        checkedAt: null,
      }),
    );
    expect(unwrap(await submissions.latestFor(templateId))).toEqual({ hubId, version: 1 });
    expect(env.opened()).toBe(1);
  });

  it('keeps a consent with the capture main finished, moved into the consent store’s folder', async () => {
    const env = libraryContainer();
    registerLibraryVoice(env.container, { userData: env.userData });
    expect(env.opened()).toBe(0);
    const captureKey = newId<'VoiceCapture'>();
    mkdirSync(voiceCapturesDir(env.userData), { recursive: true });
    const capture = join(voiceCapturesDir(env.userData), `${captureKey}.wav`);
    writeFileSync(capture, 'RIFF-recording');
    const consentId = newId<'VoiceConsent'>();
    const store = env.container.resolve(VoiceConsentStoreToken);
    unwrap(
      await store.put(
        {
          id: consentId,
          speakerName: 'Asha',
          language: 'en',
          termsVersion: VOICE_CONSENT_TERMS_VERSION,
          recordingSha256: createHash('sha256').update('RIFF-recording').digest('hex'),
          recordingDurationMs: 61_000,
          phraseMatch: 0.9,
          recordedAt: 1,
          clone: null,
        },
        { captureKey },
      ),
    );
    expect(existsSync(capture)).toBe(false);
    expect(unwrap(await store.recordingPath(consentId))).toBe(
      join(voiceRecordingsDir(env.userData), `${consentId}.wav`),
    );
  });

  it('keeps generated files under the originals root the setting names, once per process', async () => {
    const env = libraryContainer();
    const root = join(env.userData, 'Originals');
    unwrap(createSettingsRepository(env.db).set(ORIGINALS_ROOT_SETTING.key, root));
    registerLibraryGenerated(env.container);
    registerLibraryGenerated(env.container); // a second call keeps the first registration
    expect(env.opened()).toBe(0);
    const kept = unwrap(
      await env.container.resolve(GeneratedAssetSinkToken).put({
        bytes: new TextEncoder().encode('sfx'),
        mediaType: 'audio/flac',
        fileName: 'sfx-hit-01.flac',
        projectId: null,
        provenance: {
          kind: 'bundled',
          pack: 'sfx-pack',
          itemId: 'hit-01',
          licence: 'CC0-1.0',
          sourceUrl: 'https://taalcut.app/packs/sfx',
          title: 'Hit',
        },
      }),
    );
    const path = join(root, 'Generated', kept.contentHash.slice(0, 2), `${kept.contentHash}.flac`);
    expect(readFileSync(path, 'utf8')).toBe('sfx');
  });
});
