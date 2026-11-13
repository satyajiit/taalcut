// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's Telemetry in the agent process (P2-X7). record returns before the
 * consent check, the schema check or the queue write, and it does not throw.
 * Nothing is queued unless telemetry is on, Local only is off, the event
 * fits the catalogue, and this build has an endpoint.
 */
import {
  createSerialQueue,
  createToken,
  isId,
  LOCAL_ONLY_SETTING,
  newId,
  TELEMETRY_SETTING,
  telemetryEnvelopeSchema,
  telemetryEventSchema,
  type Clock,
  type ProjectId,
  type SettingsStore,
  type Telemetry,
  type TelemetryEvent,
} from '@taalcut/core';
import { resolveTelemetryEndpoint } from './endpoint';
import {
  ensureTelemetryInstall,
  forgetTelemetryInstall,
  telemetryProjectKey,
  TELEMETRY_INSTALL_SETTING,
} from './install';
import { TELEMETRY_OUTBOX_CAP, type TelemetryOutbox } from './outbox';
import {
  TELEMETRY_BATCH,
  TELEMETRY_INTERVAL_MS,
  TELEMETRY_QUIT_BUDGET_MS,
  telemetryBackoffMs,
  type TelemetryScheduler,
} from './scheduler';
import { createHttpTelemetryTransport, type TelemetryTransport } from './transport';

export interface TelemetryState {
  readonly enabled: boolean;
  readonly cohort?: string;
  readonly queued: number;
  readonly lastSentAt?: number;
}

export interface TelemetryService extends Telemetry {
  state(): Promise<TelemetryState>;
  /** Sends until the queue is empty, the gate closes, or the budget passes. */
  flush(budgetMs?: number): Promise<void>;
  /** Drops the timer and aborts a send in flight. Does not clear the queue. */
  stop(): void;
  /** Resolves when earlier record, state and flush calls have finished. */
  settled(): Promise<void>;
}

export interface TelemetryServiceOptions {
  readonly settings: SettingsStore;
  readonly outbox: TelemetryOutbox;
  readonly clock: Clock;
  readonly scheduler: TelemetryScheduler;
  /** Header value. Session facts carry their own version. */
  readonly appVersion: string;
  /** Omitted: the baked URL. '' or any non-https, non-loopback URL: queue nothing. */
  readonly endpoint?: string;
  /** Replaces the HTTPS client. Ignored when the endpoint is not usable. */
  readonly transport?: TelemetryTransport;
}

export const TelemetryServiceToken = createToken<TelemetryService>('desktop.telemetry');

type Gate = { readonly kind: 'unread' | 'off' | 'local-only' | 'on'; readonly cohort?: string };
type Outcome = 'sent' | 'empty' | 'blocked' | 'failed';

export function createTelemetryService(options: TelemetryServiceOptions): TelemetryService {
  const endpoint = resolveTelemetryEndpoint(options.endpoint);
  const transport = endpoint
    ? (options.transport ?? createHttpTelemetryTransport(endpoint, options.appVersion))
    : undefined;
  const { settings, outbox, clock, scheduler } = options;
  const sessionId = newId<'TelemetrySession'>();
  let seq = 1;
  let failures = 0;
  let lastSentAt: number | undefined;
  let stopped = false;
  /** Recording, sending and reading the state one at a time. */
  const turns = createSerialQueue();
  const aborts = new Set<AbortController>();

  /**
   * Runs `task` in turn. A failure is warned as `what`, with no cause (an outbox error can name its file), and then
   * `onFailure` runs.
   */
  function inTurn(task: () => Promise<void>, what: string, onFailure?: () => void): Promise<void> {
    return turns.run(task).catch(() => {
      console.warn(`[telemetry] ${what}`);
      onFailure?.();
    });
  }

  function arm(ms: number): void {
    if (stopped) return;
    scheduler.schedule(ms, () => {
      // An outbox that throws while sending counts as a failed send: back off and try again.
      void inTurn(tick, 'send failed', () => after('failed'));
    });
  }

  function stop(): void {
    stopped = true;
    scheduler.stop();
    for (const controller of aborts) controller.abort();
    aborts.clear();
  }

  async function reconcile(): Promise<Gate> {
    const telemetry = await settings.get(TELEMETRY_SETTING);
    const localOnly = await settings.get(LOCAL_ONLY_SETTING);
    if (!telemetry.ok || !localOnly.ok) return { kind: 'unread' };
    if (!telemetry.value.enabled) {
      await forget();
      return { kind: 'off' };
    }
    await ensureTelemetryInstall(settings);
    const cohort = telemetry.value.cohort;
    return { kind: localOnly.value ? 'local-only' : 'on', ...(cohort ? { cohort } : {}) };
  }

  async function forget(): Promise<void> {
    try {
      if ((await outbox.take(1)).length > 0) await outbox.clear();
    } catch {
      console.warn('[telemetry] outbox not cleared');
    }
    const install = await settings.get(TELEMETRY_INSTALL_SETTING);
    if (!install.ok || install.value !== null) await forgetTelemetryInstall(settings);
  }

  async function accept(event: TelemetryEvent, context?: { readonly projectId?: ProjectId }): Promise<void> {
    const gate = await reconcile();
    if (gate.kind !== 'on' || !transport) return;
    const parsed = telemetryEventSchema.safeParse(event);
    if (!parsed.success) return;
    const install = await ensureTelemetryInstall(settings);
    if (!install) return;
    const at = clock.now();
    if (!Number.isSafeInteger(at) || at < 0) return;
    const projectId = context?.projectId;
    const projectKey =
      projectId !== undefined && isId(projectId) ? telemetryProjectKey(install.salt, projectId) : undefined;
    const envelope = telemetryEnvelopeSchema.safeParse({
      v: 1,
      installId: install.installId,
      sessionId,
      ...(gate.cohort ? { cohort: gate.cohort } : {}),
      ...(projectKey ? { projectKey } : {}),
      seq,
      at,
      event: parsed.data,
    });
    if (!envelope.success) return;
    try {
      await outbox.append(envelope.data);
    } catch {
      console.warn('[telemetry] event not queued');
      return;
    }
    seq += 1;
  }

  async function sendOne(signal?: AbortSignal): Promise<Outcome> {
    if (stopped || signal?.aborted) return 'blocked';
    const gate = await reconcile();
    if (stopped || signal?.aborted) return 'blocked';
    if (gate.kind !== 'on' || !transport) return 'blocked';
    const batch = await outbox.take(TELEMETRY_BATCH);
    if (batch.length === 0) return 'empty';
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    aborts.add(controller);
    let accepted: boolean;
    try {
      accepted = await transport.post(
        batch.map((row) => row.envelope),
        controller.signal,
      );
    } catch {
      accepted = false;
    } finally {
      aborts.delete(controller);
      signal?.removeEventListener('abort', onAbort);
    }
    if (!accepted || controller.signal.aborted || stopped) return 'failed';
    await outbox.ack(batch.map((row) => row.id));
    const sentAt = clock.now();
    if (Number.isSafeInteger(sentAt) && sentAt >= 0) lastSentAt = sentAt;
    return 'sent';
  }

  function after(outcome: Outcome): void {
    if (stopped) return;
    if (outcome === 'failed') {
      failures += 1;
      arm(telemetryBackoffMs(failures));
      return;
    }
    if (outcome === 'sent') failures = 0;
    arm(TELEMETRY_INTERVAL_MS);
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    after(await sendOne());
  }

  async function drain(budgetMs: number): Promise<void> {
    const deadline = Date.now() + budgetMs;
    let outcome: Outcome = 'empty';
    while (!stopped && Date.now() < deadline) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now()));
      timer.unref();
      try {
        outcome = await sendOne(controller.signal);
      } finally {
        clearTimeout(timer);
      }
      if (outcome === 'sent') failures = 0;
      else break;
    }
    after(outcome === 'sent' ? 'empty' : outcome);
  }

  async function stateTask(): Promise<TelemetryState> {
    const telemetry = await settings.get(TELEMETRY_SETTING);
    await reconcile();
    const queued = outbox.count
      ? await outbox.count()
      : (await outbox.take(TELEMETRY_OUTBOX_CAP)).length;
    const cohort = telemetry.ok ? telemetry.value.cohort : undefined;
    return {
      enabled: telemetry.ok && telemetry.value.enabled,
      queued,
      ...(cohort ? { cohort } : {}),
      ...(lastSentAt !== undefined ? { lastSentAt } : {}),
    };
  }

  arm(TELEMETRY_INTERVAL_MS);

  return {
    record(event, context) {
      try {
        void inTurn(() => accept(event, context), 'event not recorded');
      } catch {
        // A payload that throws while being read must not reach the caller.
      }
    },
    state() {
      return turns.run(stateTask).catch(() => ({ enabled: false, queued: 0 }));
    },
    flush(budgetMs = TELEMETRY_QUIT_BUDGET_MS) {
      return inTurn(() => drain(budgetMs), 'flush failed');
    },
    stop,
    settled: () => turns.settled(),
  };
}
