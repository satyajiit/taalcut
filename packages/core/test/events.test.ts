// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The in-process event bus, the bounded event stream and the catalogue. */
import { describe, expect, it, vi } from 'vitest';
import {
  createEventBus,
  createManualClock,
  EVENT_TYPES,
  eventStream,
  forwardCommandEvents,
  fromRpcError,
  newId,
  taalcutEventSchema,
  unwrap,
  type TaalcutEvent,
} from '@taalcut/core';
import { setupBus, UI } from './helpers/bus';

const jobId = newId<'Job'>();
const progress = (fraction: number) =>
  ({ jobId, kind: 'media.probe', projectId: null, progress: { fraction } }) as const;

describe('event bus', () => {
  it('delivers typed events in subscription order and stamps them with the clock', () => {
    const bus = createEventBus({ clock: createManualClock(42) });
    const seen: string[] = [];
    bus.on('job.progress', (event) => seen.push(`job ${event.payload.progress.fraction} @${event.at}`));
    const offAny = bus.onAny((event) => seen.push(`any ${event.type}`));
    bus.onAny((event) => seen.push(`theme only ${event.type}`), ['theme.changed']);
    bus.emit('job.progress', progress(0.5));
    bus.emit('theme.changed', { preference: 'dark', resolved: 'dark' });
    offAny();
    offAny();
    bus.emit('job.progress', progress(1));
    expect(seen).toEqual([
      'job 0.5 @42',
      'any job.progress',
      'any theme.changed',
      'theme only theme.changed',
      'job 1 @42',
    ]);
  });

  it('keeps the original timestamp when republishing, and isolates throwing listeners', () => {
    const onListenerError = vi.fn();
    const bus = createEventBus({ clock: createManualClock(5), onListenerError });
    const seen: number[] = [];
    bus.onAny(() => {
      throw new Error('bad listener');
    });
    bus.onAny((event) => seen.push(event.at));
    bus.publish({ type: 'job.progress', at: 1, payload: progress(0) });
    expect(seen).toEqual([1]);
    expect(onListenerError).toHaveBeenCalledOnce();
  });

  it('logs listener errors by default', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bus = createEventBus({ clock: createManualClock() });
    bus.on('theme.changed', () => {
      throw new Error('x');
    });
    bus.emit('theme.changed', { preference: 'light', resolved: 'light' });
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it('lets a listener unsubscribe while an event is being delivered', () => {
    const bus = createEventBus({ clock: createManualClock() });
    const seen: string[] = [];
    const off = bus.onAny(() => {
      seen.push('first');
      off();
    });
    bus.onAny(() => seen.push('second'));
    bus.emit('theme.changed', { preference: 'light', resolved: 'light' });
    bus.emit('theme.changed', { preference: 'light', resolved: 'light' });
    expect(seen).toEqual(['first', 'second', 'second']);
  });

  it('publishes command-bus changes as command.changed events', async () => {
    const { bus: commands, projectId } = setupBus();
    const events = createEventBus({ clock: createManualClock(9) });
    const seen: TaalcutEvent[] = [];
    events.on('command.changed', (event) => seen.push(event));
    const stop = forwardCommandEvents(commands, events);
    unwrap(await commands.dispatch('project.rename', { projectId, name: 'Trip' }, UI));
    unwrap(await commands.undo(projectId, { source: 'shortcut', actor: 'user' }));
    stop();
    unwrap(await commands.redo(projectId, UI));
    expect(seen.map((event) => event.payload)).toMatchObject([
      { kind: 'executed', name: 'project.rename', projectId, source: 'ui', actor: 'user' },
      { kind: 'undone', name: 'project.rename', projectId, source: 'shortcut' },
    ]);
  });

  it('has recovery.changed for an agent restart after launch', () => {
    expect(EVENT_TYPES).toContain('recovery.changed');
    const changed = (payload: unknown) =>
      taalcutEventSchema.safeParse({ type: 'recovery.changed', at: 1, payload }).success;
    expect(changed({ reason: 'agent-restarted', unfinishedRuns: 1 })).toBe(true);
    expect(changed({ reason: 'launch', unfinishedRuns: 1 })).toBe(false);
    expect(changed({ reason: 'agent-restarted', unfinishedRuns: -1 })).toBe(false);
  });
});

describe('event stream', () => {
  it('buffers events until read, filters by type and ends on return()', async () => {
    const bus = createEventBus({ clock: createManualClock() });
    const stream = eventStream(bus, { types: ['job.progress'] });
    bus.emit('job.progress', progress(0.1));
    bus.emit('theme.changed', { preference: 'dark', resolved: 'dark' });
    bus.emit('job.progress', progress(0.2));
    expect((await stream.next()).value).toMatchObject({ payload: { progress: { fraction: 0.1 } } });
    expect((await stream.next()).value).toMatchObject({ payload: { progress: { fraction: 0.2 } } });
    const pending = stream.next();
    bus.emit('job.progress', progress(0.3));
    expect((await pending).value).toMatchObject({ payload: { progress: { fraction: 0.3 } } });
    await stream.return?.();
    expect(await stream.next()).toEqual({ done: true, value: undefined });
  });

  it('ends quietly when its signal aborts', async () => {
    const bus = createEventBus({ clock: createManualClock() });
    const controller = new AbortController();
    const stream = eventStream(bus, { signal: controller.signal });
    const pending = stream.next();
    controller.abort();
    expect(await pending).toEqual({ done: true, value: undefined });
    const already = eventStream(bus, { signal: AbortSignal.abort() });
    expect(await already.next()).toEqual({ done: true, value: undefined });
    await already[Symbol.asyncDispose]();
  });

  it('fails a reader that falls too far behind with a retryable overflow error', async () => {
    const bus = createEventBus({ clock: createManualClock() });
    const stream = eventStream(bus, { maxBuffered: 3 });
    for (let i = 0; i < 4; i++) bus.emit('job.progress', progress(i / 10));
    const error = fromRpcError(await stream.next().catch((cause: unknown) => cause));
    expect(error).toMatchObject({ code: 'core.event_stream_overflow', retryable: true, params: { max: 3 } });
    expect(await stream.next()).toEqual({ done: true, value: undefined });
  });
});

describe('event catalogue', () => {
  it('validates every event type and rejects unknown or malformed ones', () => {
    expect(EVENT_TYPES).toContain('job.progress');
    expect(EVENT_TYPES).toContain('agent.approvalRequested');
    const runId = newId<'AgentRun'>();
    const valid: TaalcutEvent[] = [
      {
        type: 'agent.toolStarted',
        at: 1,
        payload: { runId, toolRunId: newId(), tool: 'media.probe', sideEffect: 'read' },
      },
      {
        type: 'agent.budgetExceeded',
        at: 2,
        payload: { runId, budget: 'money', limit: 250_000, used: 260_000 },
      },
      {
        type: 'library.changed',
        at: 3,
        payload: { projectId: null, entity: 'source', change: 'created', ids: ['a'] },
      },
    ];
    for (const event of valid) expect(taalcutEventSchema.parse(event)).toEqual(event);
    expect(taalcutEventSchema.safeParse({ type: 'agent.nope', at: 1, payload: {} }).success).toBe(false);
    expect(
      taalcutEventSchema.safeParse({ type: 'job.progress', at: 1, payload: { jobId: 'x' } }).success,
    ).toBe(false);
  });
});
