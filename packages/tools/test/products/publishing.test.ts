// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { err, ok, unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { PluginAuthenticationFailed, PluginRemoteFailed } from '../../src/plugins/errors';
import { createProductPublisher } from '../../src/products/publishing';
import { publishDraft, publisherWorld } from './publishing-fixture';

describe('product publication approval and delivery', () => {
  it('requires exact revision approval, uploads the approved render, and reconciles publication', async () => {
    const world = publisherWorld();
    const draft = unwrap(await world.publisher.prepare([publishDraft()]))[0]!;
    expect(unwrap(await world.publisher.dispatch(draft.id)).status).toBe('draft');
    expect(world.invoke).not.toHaveBeenCalled();
    expect((await world.publisher.approve(draft.id, 99)).ok).toBe(false);
    unwrap(await world.publisher.approve(draft.id, draft.revision));
    const scheduled = unwrap(await world.publisher.dispatch(draft.id));
    expect(scheduled.status).toBe('scheduled');
    expect(scheduled.remotePostId).toBe('remote-one');
    const upload = world.invoke.mock.calls.find(([call]) => call.toolName === 'api.uploadFile')![0];
    expect(upload.input).toEqual({
      renderId: draft.renderId,
      expectedSha256: draft.mediaHash,
      adjust: false,
    });
    world.invoke.mockImplementationOnce(async () =>
      ok({
        posts: [
          {
            id: 'remote-one',
            content: draft.content,
            publishDate: draft.scheduledAt,
            state: 'PUBLISHED',
            releaseURL: 'https://youtube.com/watch?v=abc',
            integration: { id: draft.accountId },
          },
        ],
      }),
    );
    expect(unwrap(await world.publisher.reconcile(draft.id)).status).toBe('published');
  });

  it('rejects edited copy, changed campaign and replaced media after approval', async () => {
    for (const change of ['copy', 'campaign', 'media']) {
      const world = publisherWorld();
      const draft = unwrap(await world.publisher.prepare([publishDraft()]))[0]!;
      const approved = unwrap(await world.publisher.approve(draft.id, 1));
      if (change === 'copy') world.records.set(draft.id, { ...approved, content: 'Different claim.' });
      if (change === 'campaign') world.campaignRevision.mockResolvedValue(ok(2));
      if (change === 'media') world.verifyRender.mockResolvedValue(ok(false));
      expect(unwrap(await world.publisher.dispatch(draft.id))).toMatchObject({
        status: 'failed',
        approvalHash: null,
      });
      expect(world.invoke).not.toHaveBeenCalled();
    }
  });

  it('never repeats an ambiguous create after timeout or process restart', async () => {
    const world = publisherWorld();
    const draft = unwrap(await world.publisher.prepare([publishDraft()]))[0]!;
    unwrap(await world.publisher.approve(draft.id, 1));
    const original = world.invoke.getMockImplementation()!;
    world.invoke.mockImplementation(async (call) =>
      call.toolName === 'api.createPost'
        ? err(PluginRemoteFailed({ pluginId: 'postiz', status: 503, outcome: 'unknown' }))
        : original(call),
    );
    expect(unwrap(await world.publisher.dispatch(draft.id)).status).toBe('unknown');
    const restarted = createProductPublisher(world.deps);
    unwrap(await restarted.dispatch(draft.id));
    expect(unwrap(await restarted.reconcile(draft.id)).status).toBe('unknown');
    expect(world.invoke.mock.calls.filter(([call]) => call.toolName === 'api.createPost')).toHaveLength(1);
  });

  it('retains retry timing for a definite rate-limit rejection without retrying immediately', async () => {
    const world = publisherWorld();
    const draft = unwrap(await world.publisher.prepare([publishDraft()]))[0]!;
    unwrap(await world.publisher.approve(draft.id, 1));
    const original = world.invoke.getMockImplementation()!;
    world.invoke.mockImplementation(async (call) =>
      call.toolName === 'api.createPost'
        ? err(PluginRemoteFailed({ pluginId: 'postiz', status: 429, retryAfterMs: 120_000 }))
        : original(call),
    );
    const delayed = unwrap(await world.publisher.dispatch(draft.id));
    expect(delayed.status).toBe('approved');
    expect(delayed.retryAt).toBe(world.deps.now() + 120_000);
    unwrap(await world.publisher.dispatch(draft.id));
    expect(world.invoke.mock.calls.filter(([call]) => call.toolName === 'api.createPost')).toHaveLength(1);
    world.advance(120_000);
    world.invoke.mockImplementation(original);
    expect(unwrap(await world.publisher.dispatch(draft.id)).status).toBe('scheduled');
    expect(world.invoke.mock.calls.filter(([call]) => call.toolName === 'api.uploadFile')).toHaveLength(1);
  });

  it('claims one publication once under concurrent dispatches', async () => {
    const world = publisherWorld();
    const draft = unwrap(await world.publisher.prepare([publishDraft()]))[0]!;
    unwrap(await world.publisher.approve(draft.id, 1));
    await Promise.all([world.publisher.dispatch(draft.id), world.publisher.dispatch(draft.id)]);
    expect(world.invoke.mock.calls.filter(([call]) => call.toolName === 'api.createPost')).toHaveLength(1);
  });
  it('records a definite authentication rejection as failed rather than an ambiguous create', async () => {
    const world = publisherWorld();
    const draft = unwrap(await world.publisher.prepare([publishDraft()]))[0]!;
    unwrap(await world.publisher.approve(draft.id, 1));
    const original = world.invoke.getMockImplementation()!;
    world.invoke.mockImplementation(async (call) =>
      call.toolName === 'api.uploadFile'
        ? err(PluginAuthenticationFailed({ pluginId: 'postiz' }))
        : original(call),
    );
    expect(unwrap(await world.publisher.dispatch(draft.id)).status).toBe('failed');
    expect(world.invoke.mock.calls.some(([call]) => call.toolName === 'api.createPost')).toBe(false);
  });
  it('does not rewrite timestamps for unchanged remote schedules or unresolved outcomes', async () => {
    const world = publisherWorld();
    const draft = unwrap(await world.publisher.prepare([publishDraft()]))[0]!;
    unwrap(await world.publisher.approve(draft.id, 1));
    const scheduled = unwrap(await world.publisher.dispatch(draft.id));
    world.invoke.mockResolvedValue(
      ok({
        posts: [
          {
            id: scheduled.remotePostId,
            content: draft.content,
            publishDate: draft.scheduledAt,
            state: 'QUEUE',
            integration: { id: draft.accountId },
          },
        ],
      }),
    );
    world.advance(60_000);
    expect(unwrap(await world.publisher.reconcile(draft.id))).toEqual(scheduled);
    world.records.set(draft.id, {
      ...scheduled,
      status: 'unknown',
      remotePostId: null,
      errorCode: 'publish.outcome_unknown',
    });
    const unknown = world.records.get(draft.id)!;
    expect(unwrap(await world.publisher.reconcile(draft.id))).toEqual(unknown);
  });
});
