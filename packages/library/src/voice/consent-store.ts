// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's VoiceConsentStore (P3-B6) over migration 22, in the agent process. A consent row per speaker, and its
 * recording moved out of main's captures folder into the store's own (`<userData>/voice-consent/recordings`),
 * named by the consent id. The recording is never synced and is read only for the clone upload.
 *
 * `put` runs after audio's consent command has claimed the capture from main (voiceCaptureFilesContract.claim
 * answers once) and checked it, so the store finds the claimed file through its `captures` port and keeps it
 * only when its sha256 is the one the consent records: the file audio heard is the file kept.
 *
 * No consent without its recording, and no recording nobody lists, across a crash too (Phase 3 review H4). The
 * file moves in first (its folder fsynced), the row second; a failed insert removes the file again. A kill between
 * the two leaves a recording with no row: the store removes such orphans once, before its first operation, and
 * nothing else runs until that sweep is done. (Row first left a consent whose recording stayed in main's captures
 * folder, which main's sweep deletes after an hour; and the claim answers once, so no retry could finish it.)
 */
import {
  ConflictError,
  err,
  NotFoundError,
  ok,
  parseId,
  toTaalcutError,
  ValidationError,
  voiceCloneSchema,
  type AsyncResult,
  type Result,
  type VoiceCaptureId,
  type VoiceConsent,
  type VoiceConsentId,
  type VoiceConsentStore,
} from '@taalcut/core';
import { desc, eq } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { isFile } from '../files/file-presence';
import { attemptWrite, touched } from '../repositories/shared';
import { voiceConsents } from '../schema/voice';
import { fromRow, parseConsent, toRow } from './consent-rows';
import { VoiceRecordingMismatch } from './errors';
import {
  moveRecording,
  prepareDir,
  recordingFile,
  removeOrphanRecordings,
  removeRecording,
  sha256OfFile,
} from './recording-files';
import { sweepFirst } from './sweep-first';

/** Where main left a claimed capture (`<userData>/voice-consent/captures/<captureId>.wav`). */
export interface VoiceCaptureSource {
  locate(captureKey: VoiceCaptureId): AsyncResult<string>;
}

export interface VoiceConsentStoreOptions {
  /** The store's folder, `<userData>/voice-consent/recordings`. */
  readonly dir: string;
  readonly captures: VoiceCaptureSource;
}

const ENTITY = 'voice_consent';

/** Runs file work, turning Node's errors into error values. */
async function attempt<T>(work: () => Promise<T>): AsyncResult<T> {
  try {
    return ok(await work());
  } catch (cause) {
    return err(toTaalcutError(cause));
  }
}

export function createVoiceConsentStore(
  db: LibraryDatabase,
  options: VoiceConsentStoreOptions,
): VoiceConsentStore {
  const { orm } = db;
  const row = (id: VoiceConsentId) => orm.select().from(voiceConsents).where(eq(voiceConsents.id, id)).get();
  const deleteRow = (id: VoiceConsentId) =>
    attemptWrite(db, ENTITY, () => orm.delete(voiceConsents).where(eq(voiceConsents.id, id)).run());

  function get(id: VoiceConsentId): Result<VoiceConsent | null> {
    const found = row(id);
    return found ? fromRow(found) : ok(null);
  }

  function list(): Result<VoiceConsent[]> {
    const consents: VoiceConsent[] = [];
    const rows = orm
      .select()
      .from(voiceConsents)
      .orderBy(desc(voiceConsents.recordedAt), desc(voiceConsents.id));
    for (const stored of rows.all()) {
      const consent = fromRow(stored);
      if (!consent.ok) return consent;
      consents.push(consent.value);
    }
    return ok(consents);
  }

  /** The claimed capture, checked against the consent's hash. */
  async function claimedRecording(consent: VoiceConsent, captureKey: string): AsyncResult<string> {
    const key = parseId<'VoiceCapture'>(captureKey);
    if (!key.ok) return err(ValidationError({ field: 'captureKey' }));
    const located = await options.captures.locate(key.value);
    if (!located.ok) return located;
    const path = located.value;
    const present = await attempt(() => isFile(path));
    if (!present.ok) return present;
    if (!present.value) return err(NotFoundError({ entity: 'voice_capture', id: key.value }));
    const sha256 = await attempt(() => sha256OfFile(path));
    if (!sha256.ok) return sha256;
    if (sha256.value !== consent.recordingSha256)
      return err(VoiceRecordingMismatch(undefined, { detail: `capture ${key.value}` }));
    return ok(path);
  }

  // Recordings a kill left between their move and their row go, once, before anything else runs.
  const afterSweep = sweepFirst(() =>
    attempt(() => removeOrphanRecordings(options.dir, (id) => row(id) !== undefined)),
  );

  async function put(input: VoiceConsent, recording: { readonly captureKey: string }): AsyncResult<void> {
    const consent = parseConsent(input);
    if (!consent.ok) return consent;
    const { id } = consent.value;
    if (row(id)) return err(ConflictError({ entity: ENTITY, id }));
    const from = await claimedRecording(consent.value, recording.captureKey);
    if (!from.ok) return from;
    const prepared = await attempt(() => prepareDir(options.dir));
    if (!prepared.ok) return prepared;
    const file = recordingFile(options.dir, id);
    // The capture stays where main left it when the move fails (main's sweep deletes it).
    const moved = await attempt(() => moveRecording(from.value, file, options.dir));
    if (!moved.ok) return moved;
    const written = attemptWrite(db, ENTITY, () =>
      orm.insert(voiceConsents).values(toRow(consent.value, db.clock())).run(),
    );
    if (written.ok) return ok(undefined);
    // No consent, so no recording: the claim answered once, so this capture can't be used again anyway.
    const removed = await attempt(() => removeRecording(file));
    return removed.ok ? written : removed;
  }

  async function recordingPath(id: VoiceConsentId): AsyncResult<string> {
    if (!row(id)) return err(NotFoundError({ entity: ENTITY, id }));
    const path = recordingFile(options.dir, id);
    const present = await attempt(() => isFile(path));
    if (!present.ok) return present;
    return present.value ? ok(path) : err(NotFoundError({ entity: 'voice_consent_recording', id }));
  }

  function setClone(id: VoiceConsentId, clone: VoiceConsent['clone']): Result<void> {
    const parsed = voiceCloneSchema.nullable().safeParse(clone);
    if (!parsed.success) return err(ValidationError({ field: 'clone' }));
    const changed = attemptWrite(
      db,
      ENTITY,
      () =>
        orm
          .update(voiceConsents)
          .set({ clone: parsed.data, updatedAt: db.clock() })
          .where(eq(voiceConsents.id, id))
          .run().changes,
    );
    return changed.ok ? touched(changed.value, ENTITY, id) : changed;
  }

  /** The row and the recording; withdrawing twice is not an error. */
  async function remove(id: VoiceConsentId): AsyncResult<void> {
    const deleted = deleteRow(id);
    if (!deleted.ok) return deleted;
    return attempt(() => removeRecording(recordingFile(options.dir, id)));
  }

  return {
    get: afterSweep(get),
    list: afterSweep(list),
    recordingPath: afterSweep(recordingPath),
    put: afterSweep(put),
    setClone: afterSweep(setClone),
    delete: afterSweep(remove),
  };
}
