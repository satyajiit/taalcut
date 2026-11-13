// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-RUN: a model call that dropped is tried again before the run fails. The owner's Editor turn ran 5 minutes,
 * then failed with models.provider_unavailable ("terminated"), and the run failed at once. Now each dropped call is
 * logged as model.failed with `retry` and asked again, up to three times; a refusal (a bad request) still fails
 * the run at once, and a rate limit that lifts within a minute is waited out.
 */
import { unwrap, type TaalcutError } from '@taalcut/core';
import type { ModelScript, ScriptedReply } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { call, harness, ofType, plan, turns } from './support/harness';

const fail = (code: string, params?: Record<string, unknown>): TaalcutError => ({
  code,
  messageKey: `errors.${code}`,
  retryable: true,
  detail: 'terminated',
  ...(params ? { params: params as TaalcutError['params'] } : {}),
});

const replies = turns(
  plan('Count'),
  { toolCalls: [call('clips_countWords', { text: 'a' })] },
  { text: 'Counted.' },
);

/** The script, with the model calls numbered in `failing` answered by `error` instead. */
function dropping(
  failing: readonly number[],
  error: TaalcutError,
): { script: ModelScript; calls: () => number } {
  let n = 0;
  const script: ModelScript = (request, turn): ScriptedReply => {
    n += 1;
    return failing.includes(n) ? { error } : replies(request, turn);
  };
  return { script, calls: () => n };
}

const noWait = { loop: { modelRetryDelaysMs: [0, 0, 0] } };

describe('a dropped model call is tried again (FIX-RUN)', () => {
  it('retries a terminated stream and the run goes on, each retry in the log', async () => {
    const { script, calls } = dropping([2, 3], fail('models.provider_unavailable'));
    const h = harness({ script, settings: noWait });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'count' }));
    expect(outcome).toMatchObject({ status: 'completed', report: 'Counted.' });
    expect(calls()).toBe(5);
    const events = await h.events(outcome.runId);
    expect(ofType(events, 'model.failed').map((e) => e.payload.retry)).toEqual([
      { attempt: 1, of: 3, delayMs: 0 },
      { attempt: 2, of: 3, delayMs: 0 },
    ]);
    expect(ofType(events, 'run.failed')).toEqual([]);
  });

  it('fails the run after three retries', async () => {
    const { script, calls } = dropping([2, 3, 4, 5, 6], fail('models.provider_unavailable'));
    const h = harness({ script, settings: noWait });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'count' }));
    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'models.provider_unavailable' } });
    expect(calls()).toBe(5);
    const failed = ofType(await h.events(outcome.runId), 'model.failed').map((e) => e.payload.retry?.attempt);
    expect(failed).toEqual([1, 2, 3, undefined]);
  });

  it('a new drop after an answer gets its own three retries', async () => {
    const { script } = dropping([2, 3, 4, 6, 7], fail('models.provider_unavailable'));
    const h = harness({ script, settings: noWait });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'count' }));
    expect(outcome.status).toBe('completed');
  });

  it('waits the backoff before the retry', async () => {
    const { script } = dropping([2], fail('models.provider_unavailable'));
    const h = harness({ script, settings: { loop: { modelRetryDelaysMs: [5] } } });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'count' }));
    expect(outcome.status).toBe('completed');
    const retry = ofType(await h.events(outcome.runId), 'model.failed')[0]?.payload.retry;
    expect(retry).toEqual({ attempt: 1, of: 1, delayMs: 5 });
  });

  it('waits out a rate limit that lifts within a minute', async () => {
    const { script } = dropping([2], fail('models.rate_limited', { retryAfterMs: 1 }));
    const h = harness({ script, settings: noWait });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'count' }));
    expect(outcome.status).toBe('completed');
    expect(ofType(await h.events(outcome.runId), 'model.failed')[0]?.payload.retry?.delayMs).toBe(1);
  });

  it('does not retry a refusal: a bad request fails the run at once', async () => {
    const { script, calls } = dropping([2], fail('models.bad_request'));
    const h = harness({ script, settings: noWait });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'count' }));
    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'models.bad_request' } });
    expect(calls()).toBe(2);
  });
});
