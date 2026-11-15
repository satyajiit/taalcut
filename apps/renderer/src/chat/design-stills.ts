// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG2: a design option's still for the picker (CardData.designStill). The Designer's render of each option over
 * the person's video is kept with the project's workspace files, named by its sha256; `workspace.read` hands a
 * small JPEG or PNG back as base64, shown here as a data: URL (the CSP allows data: images). Bytes never change
 * under a sha256, so each still is read once; a read that failed is asked again next time.
 */
import { callRpc, type ProjectId } from '@taalcut/core';
import type { CardData } from '@taalcut/ui';
import type { Backend } from '../backend/backend';

export function designStillReader(backend: Backend): NonNullable<CardData['designStill']> {
  const known = new Map<string, Promise<string | null>>();
  return (projectId: ProjectId, sha256: string) => {
    const key = `${projectId}:${sha256}`;
    const held = known.get(key);
    if (held) return held;
    const read = callRpc(backend.workspace.read({ projectId, sha256 })).then((file) => {
      const image = file.ok ? file.value.image : undefined;
      if (!image) known.delete(key);
      return image ? `data:${image.mimeType};base64,${image.dataBase64}` : null;
    });
    known.set(key, read);
    return read;
  };
}
