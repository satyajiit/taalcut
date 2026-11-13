// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * An in-memory StyleStore (P3-V10). The library lane's SQLite store is the production one; this is the
 * package's persistence port for tests: snapshot to JSON, construct again, and the documents and logo bytes
 * are still there. Revisions conflict unless `expectedRevision` is the stored one.
 */
import {
  ConflictError,
  err,
  NotFoundError,
  ok,
  type LogoMediaType,
  type Style,
  type StyleId,
  type StyleStore,
  type StyleSummary,
  type StyleUsage,
} from '@taalcut/core';
import { createMemoryAssets } from './memory-assets';

export interface MemoryStyleSnapshot {
  readonly styles: Style[];
  readonly assets: readonly {
    readonly sha256: string;
    readonly mediaType: LogoMediaType;
    readonly bytes: number[];
  }[];
  readonly usage: readonly {
    readonly styleId: StyleId;
    readonly timelines: number;
    readonly templates: number;
  }[];
}

export interface MemoryStyleStore extends StyleStore {
  setUsage(styleId: StyleId, usage: StyleUsage): void;
  assetBytes(sha256: string): Uint8Array | undefined;
  snapshot(): MemoryStyleSnapshot;
}

const clone = <T>(value: T): T => structuredClone(value);

function summarise(style: Style): StyleSummary {
  return {
    id: style.id,
    name: style.name,
    kind: style.kind,
    revision: style.revision,
    colours: style.colours,
    logo: style.logo
      ? {
          asset: style.logo.asset,
          mediaType: style.logo.mediaType,
          width: style.logo.width,
          height: style.logo.height,
        }
      : null,
    isDefault: false,
    updatedAt: style.updatedAt,
  };
}

export function createMemoryStyleStore(snapshot?: MemoryStyleSnapshot): MemoryStyleStore {
  const styles = new Map<StyleId, Style>((snapshot?.styles ?? []).map((style) => [style.id, clone(style)]));
  const assets = createMemoryAssets<{ readonly mediaType: LogoMediaType }>(
    'styles',
    (snapshot?.assets ?? []).map((asset) => [
      asset.sha256,
      { bytes: Uint8Array.from(asset.bytes), mediaType: asset.mediaType },
    ]),
  );
  const usage = new Map<StyleId, StyleUsage>(
    (snapshot?.usage ?? []).map((row) => [
      row.styleId,
      { timelines: row.timelines, templates: row.templates },
    ]),
  );

  const load = (styleId: StyleId) => {
    const style = styles.get(styleId);
    return style ? ok(style) : err(NotFoundError({ entity: 'style', id: styleId }));
  };

  return {
    async create(style) {
      if (styles.has(style.id)) return err(ConflictError({ entity: 'style', id: style.id }));
      styles.set(style.id, clone(style));
      return ok(clone(style));
    },

    async put(style, expectedRevision) {
      const current = load(style.id);
      if (!current.ok) return current;
      if (current.value.revision !== expectedRevision)
        return err(
          ConflictError(
            { entity: 'style', id: style.id },
            { detail: `revision is ${current.value.revision}` },
          ),
        );
      styles.set(style.id, clone(style));
      return ok(clone(style));
    },

    async get(styleId) {
      const found = load(styleId);
      return found.ok ? ok(clone(found.value)) : found;
    },

    async list() {
      const items = [...styles.values()]
        .map(summarise)
        .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : -1));
      return ok(items);
    },

    async remove(styleId) {
      const found = load(styleId);
      if (!found.ok) return found;
      styles.delete(styleId);
      usage.delete(styleId);
      return ok(undefined);
    },

    async usedBy(styleId) {
      const found = load(styleId);
      if (!found.ok) return found;
      return ok(usage.get(styleId) ?? { timelines: 0, templates: 0 });
    },

    putAsset: (bytes, mediaType) => assets.put(bytes, { mediaType }),
    assetPath: (sha256) => assets.path(sha256),

    setUsage(styleId, next) {
      usage.set(styleId, { timelines: next.timelines, templates: next.templates });
    },

    assetBytes: (sha256) => assets.bytes(sha256),

    snapshot() {
      return {
        styles: [...styles.values()].map(clone),
        assets: assets.entries().map(([sha256, asset]) => ({
          sha256,
          mediaType: asset.mediaType,
          bytes: [...asset.bytes],
        })),
        usage: [...usage.entries()].map(([styleId, row]) => ({ styleId, ...row })),
      };
    },
  };
}
