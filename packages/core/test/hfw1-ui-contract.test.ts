// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-UI: the files viewer's read-only namespace (appContract.workspace) over the workspace store, and the motion
 * graphic card naming a composition instead of a kind. Made-up files only.
 */
import { describe, expect, it } from 'vitest';
import {
  APP_ROUTES,
  appContract,
  err,
  newId,
  NotFoundError,
  ok,
  parseCard,
  RationalTime,
  UTILITY_CONTRACTS,
  WORKSPACE_LIST_MAX,
  workspaceFilesOver,
  workspaceFileTextSchema,
  workspaceListingSchema,
  workspaceText,
  type ProjectId,
  type WorkspaceRevision,
  type WorkspaceStore,
} from '../src';
import { COMPOSITION, FILES, sha } from './helpers/hfw1';

const projectId = newId<'Project'>();

const revision = (n: number, base = n - 1): WorkspaceRevision => ({
  projectId,
  revision: n,
  base,
  files: FILES,
  createdAt: 1_700_000_000_000 + n,
  origin: 'agent',
});

/** A store with revisions 1..`count`, its head at `head`, and blobs by sha256. */
function storeOf(
  count: number,
  head: number,
  blobs: Record<string, Uint8Array> = {},
  listing = false,
): WorkspaceStore & { reads: number } {
  const store = {
    reads: 0,
    putBlob: () => Promise.resolve(err(NotFoundError())),
    readBlob: (_project: ProjectId, sha256: string) =>
      Promise.resolve(
        blobs[sha256] ? ok(blobs[sha256]) : err(NotFoundError({ entity: 'workspaceBlob', id: sha256 })),
      ),
    head: () => Promise.resolve(ok(head === 0 ? null : revision(head))),
    revision: (_project: ProjectId, n: number) => {
      store.reads += 1;
      return Promise.resolve(
        n >= 1 && n <= count ? ok(revision(n)) : err(NotFoundError({ entity: 'workspaceRevision' })),
      );
    },
    ...(listing
      ? {
          revisions: (_project: ProjectId, limit: number) =>
            Promise.resolve(
              ok(
                Array.from({ length: Math.min(limit, count) }, (_, index) => revision(index + 1)), // oldest first
              ),
            ),
        }
      : {}),
  };
  return store;
}

describe('the workspace namespace', () => {
  it('is the agent’s and read-only', () => {
    expect(APP_ROUTES.workspace).toBe('agent');
    expect(UTILITY_CONTRACTS.agent.workspace).toBe(appContract.workspace);
    expect(Object.keys(appContract.workspace).sort()).toEqual(['list', 'read']);
  });

  it('lists the revisions newest first, the ones after a restored head too', async () => {
    const files = workspaceFilesOver(storeOf(4, 2));
    const listed = await files.list({ projectId });
    expect(listed.ok && listed.value.head).toBe(2);
    expect(listed.ok && listed.value.revisions.map((each) => each.revision)).toEqual([4, 3, 2, 1]);
    expect(listed.ok && workspaceListingSchema.safeParse(listed.value).success).toBe(true);
    const two = await files.list({ projectId, limit: 2 });
    expect(two.ok && two.value.revisions.map((each) => each.revision)).toEqual([4, 3]);
  });

  it('an empty workspace has head 0 and no revisions', async () => {
    const listed = await workspaceFilesOver(storeOf(0, 0)).list({ projectId });
    expect(listed).toEqual(ok({ head: 0, revisions: [] }));
  });

  it('uses the store’s own listing when it has one, newest first', async () => {
    const store = storeOf(3, 3, {}, true);
    const listed = await workspaceFilesOver(store).list({ projectId });
    expect(listed.ok && listed.value.revisions.map((each) => each.revision)).toEqual([3, 2, 1]);
    expect(store.reads).toBe(0);
  });

  it('caps a listing at its most', async () => {
    const listed = await workspaceFilesOver(storeOf(WORKSPACE_LIST_MAX + 5, WORKSPACE_LIST_MAX + 5)).list({
      projectId,
    });
    expect(listed.ok && listed.value.revisions).toHaveLength(WORKSPACE_LIST_MAX);
  });

  it('reads a file as text, an image as no text, and a missing one as not found', async () => {
    const html = new TextEncoder().encode('<div class="clip">Hello</div>');
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]);
    const files = workspaceFilesOver(storeOf(1, 1, { [sha('a')]: html, [sha('d')]: png }));
    const text = await files.read({ projectId, sha256: sha('a') });
    expect(text).toEqual(
      ok({ sha256: sha('a'), bytes: html.byteLength, text: '<div class="clip">Hello</div>' }),
    );
    expect(text.ok && workspaceFileTextSchema.safeParse(text.value).success).toBe(true);
    const image = await files.read({ projectId, sha256: sha('d') });
    expect(image.ok && image.value.text).toBeNull();
    const missing = await files.read({ projectId, sha256: sha('f') });
    expect(!missing.ok && missing.error.code).toBe('core.not_found');
  });

  it('bytes that aren’t UTF-8 are no text', () => {
    expect(workspaceText(new Uint8Array([0xff, 0xfe, 0x41]))).toBeNull();
    expect(workspaceText(new TextEncoder().encode('ok'))).toBe('ok');
  });
});

describe('the motion graphic card', () => {
  const card = {
    type: 'motionGraphic',
    id: 'tool:1',
    version: 1,
    projectId,
    timelineId: newId<'Timeline'>(),
    itemId: newId<'TimelineItem'>(),
    start: RationalTime.of(120, { num: 30, den: 1 }),
    duration: RationalTime.of(90, { num: 30, den: 1 }),
    unmatched: [],
  };

  it('names the composition a designed graphic is drawn with', () => {
    const parsed = parseCard({ ...card, composition: { id: COMPOSITION.id, name: 'Message bubble' } });
    expect(parsed.ok && parsed.value.type === 'motionGraphic' && parsed.value.composition?.name).toBe(
      'Message bubble',
    );
  });

  it('always names a composition, never a kit kind and fields (HFW1 retire)', () => {
    const fields = { kind: 'lowerThird', title: 'A name' } as const;
    expect(parseCard({ ...card, kind: 'lowerThird', fields }).ok).toBe(false);
    expect(parseCard(card).ok).toBe(false);
    expect(parseCard({ ...card, composition: { id: COMPOSITION.id, name: ' ' } }).ok).toBe(false);
  });
});
