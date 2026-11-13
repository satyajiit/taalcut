// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { join } from 'node:path';
import { fileSize } from '../store/uploads';
import { tusError } from '../tus/mount';
import type { SessionBox } from './box';
import type { LiveFile } from './live';

/** A resumed tus upload reserves only bytes still absent from its partial file. */
export async function reserveUploadSpace(box: SessionBox, file: LiveFile) {
  const space = box.deps.importSink.space;
  if (!space || file.spaceReserved) return;
  if (!file.spaceReservation)
    file.spaceReservation = (async () => {
      // A killed LAN process may have left this upload's reservation behind; its partial bytes already use disk.
      space.release(file.id);
      const dir = box.current?.stagingDir;
      const offset = dir ? ((await fileSize(join(dir, file.id))) ?? 0) : 0;
      const reserved = await space.reserve(file.id, Math.max(0, file.sizeBytes - offset));
      if (!reserved.ok) throw tusError(507, 'disk_full');
      file.spaceReserved = true;
      file.spaceOffset = offset;
    })();
  try {
    await file.spaceReservation;
  } finally {
    delete file.spaceReservation;
  }
}
export function consumeUploadSpace(box: SessionBox, file: LiveFile, offset: number) {
  const delta = Math.max(0, offset - (file.spaceOffset ?? 0));
  box.deps.importSink.space?.consume(file.id, delta);
  file.spaceOffset = Math.max(file.spaceOffset ?? 0, offset);
}
export function releaseUploadSpace(box: SessionBox, file: LiveFile) {
  box.deps.importSink.space?.release(file.id);
  file.spaceReserved = false;
}
