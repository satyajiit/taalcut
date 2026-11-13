// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The download of everything this Mac needs (UX2-DOWNLOADER): every component the hardware tier lists, with what
 * they depend on. Nothing is optional, so it is one download: started once (first run), it goes on by itself
 * after a restart until every component is installed, unless the person paused it. It checks the disk first,
 * downloads in a few lanes at once (run.ts), resumes partial files, verifies each one, and keeps each component's
 * last failure; one failure doesn't stop the others, and the set isn't ready until every component is installed.
 * `downloads.json` beside the registry keeps what was asked (saved.ts).
 */
import { join } from 'node:path';
import {
  CancelledError,
  createSerialQueue,
  err,
  ok,
  ValidationError,
  type AsyncResult,
  type Result,
  type TaalcutError,
} from '@taalcut/core';
import { JsonState, type StateLog } from '../json-state';
import type { ComponentManager, SpaceCheck } from '../manager-api';
import type { ComponentEntry, ComponentManifest } from '../manifest';
import { currentPlatform, selectArtifact } from '../selection';
import { termsHolds, unacceptedTerms, type TermsBook } from '../terms';
import { dependenciesOf, downloadOrder } from './order';
import { describeChoices, type MachineFit } from './choices';
import { planSet, variantHere, type SelectionInput, type SetPlan } from './plan';
import { buildReport, type DownloadSetStatus } from './report';
import { DownloadRun } from './run';
import { NOTHING_ASKED, SavedDownloadsSchema, type SavedDownloads } from './saved';

export type { MachineFit } from './choices';

export interface DownloadSetOptions {
  readonly manager: ComponentManager;
  readonly manifest: ComponentManifest;
  /** The components folder: `downloads.json` goes beside the registry. */
  readonly root: string;
  /** This Mac: an error when it can't be told (then the download can't know what this Mac needs). */
  readonly machine: () => AsyncResult<MachineFit>;
  /**
   * Where the person's acceptance of a component owner's terms is read (LNX1-TRM, terms.ts). Absent: no such terms
   * count as accepted, so those components and what depends on them stay out.
   */
  readonly terms?: TermsBook;
  readonly platform?: string;
  /** Downloads at once. Default 3. */
  readonly lanes?: number;
  readonly now?: () => number;
  readonly log?: StateLog;
  /** Something changed: `progress` as bytes arrive (the caller throttles), `state` when anything else does. */
  readonly onChange?: (kind: 'progress' | 'state') => void;
}

export interface DownloadSet {
  /** At launch: goes on with an unfinished download that wasn't paused. */
  restore(): Promise<void>;
  /** Starts it, or picks it up after a pause or a failure; `first` (needed components) go to the front. */
  start(options?: { readonly first?: readonly string[] }): AsyncResult<DownloadSetStatus>;
  /** Stops every download where it is; it stays paused across restarts until started again. */
  pause(): Promise<DownloadSetStatus>;
  /** Stops them and deletes their partial files; installed components stay. */
  cancel(): Promise<DownloadSetStatus>;
  status(): Promise<DownloadSetStatus>;
  /**
   * The member of `id`'s variant group this set takes here (plan.ts variantHere): what an install asking for the build
   * that runs here gets. `id` itself when the machine can't be told.
   */
  variantOf(id: string): AsyncResult<string>;
  /**
   * The process is going away: stops the running downloads and changes nothing that was asked. Resolves once a
   * start, pause or cancel asked before it has finished, every download has let go of its files and every write
   * of `downloads.json` is on disk. Nothing writes after: a later start says core.cancelled, and a restore, pause
   * or cancel changes nothing.
   */
  stop(): Promise<void>;
}

export function createDownloadSet(options: DownloadSetOptions): DownloadSet {
  return new Downloads(options);
}

const DEFAULT_LANES = 3;

class Downloads implements DownloadSet {
  private readonly file: JsonState<SavedDownloads>;
  private readonly platform: string;
  private readonly log: StateLog;
  private saved: SavedDownloads | undefined;
  private run: DownloadRun | undefined;
  /** Start, pause, cancel and restore one at a time, in the order asked. */
  private readonly turns = createSerialQueue();
  /** Set by stop(): what is asked after it does nothing. */
  private closed = false;

  constructor(private readonly options: DownloadSetOptions) {
    const log = options.log ?? ((message: string) => console.warn(message));
    this.log = log;
    this.file = new JsonState(join(options.root, 'downloads.json'), SavedDownloadsSchema, NOTHING_ASKED, log);
    this.platform = options.platform ?? currentPlatform();
  }

  restore(): Promise<void> {
    return this.turns.run(async () => {
      if (this.closed) return;
      const saved = await this.load();
      if (saved.requested && !saved.paused) await this.begin();
    });
  }

  start(options: { readonly first?: readonly string[] } = {}): AsyncResult<DownloadSetStatus> {
    return this.turns.run(async () => {
      if (this.closed) return err(CancelledError());
      const saved = await this.load();
      if (options.first) {
        const needed = await this.needed();
        if (!needed.ok) return this.refuse(needed.error);
        const outside = options.first.filter((id) => !needed.value.some((c) => c.id === id));
        if (outside.length > 0)
          return err(
            ValidationError({ field: 'first' }, { detail: `Not needed here: ${outside.join(', ')}` }),
          );
      }
      await this.save({
        ...saved,
        requested: true,
        paused: false,
        first: [...(options.first ?? saved.first)],
      });
      const begun = await this.begin();
      return begun.ok ? ok(await this.status()) : begun;
    });
  }

  pause(): Promise<DownloadSetStatus> {
    return this.turns.run(async () => {
      if (this.closed) return this.status();
      await this.save({ ...(await this.load()), paused: true });
      await this.halt();
      return this.status();
    });
  }

  cancel(): Promise<DownloadSetStatus> {
    return this.turns.run(async () => {
      if (this.closed) return this.status();
      await this.load();
      await this.halt();
      await this.save(NOTHING_ASKED());
      const needed = await this.needed();
      const statuses = await this.options.manager.list();
      const here = new Set(statuses.filter((s) => s.state === 'installed').map((s) => s.id));
      if (needed.ok)
        for (const component of needed.value)
          if (!here.has(component.id)) await this.options.manager.discardDownloads(component.id);
      this.changed('state');
      return this.status();
    });
  }

  async stop(): Promise<void> {
    this.closed = true;
    // After what was asked before it, so a start waiting its turn can't begin a pass once this has halted.
    await this.turns.run(() => this.halt());
    await this.file.settled();
  }

  async status(): Promise<DownloadSetStatus> {
    const saved = await this.load();
    const plan = await this.plan();
    if (!plan.ok) return this.unknown(plan.error);
    const needed = plan.value.needed;
    // The pass as it is before the list is read: a pass that ends meanwhile has already let go of its installs, so
    // the list never shows one running that the pass doesn't (a later read sees the pass gone).
    const run = this.run;
    const statuses = await this.options.manager.list();
    const here = new Set(statuses.filter((s) => s.state === 'installed').map((s) => s.id));
    const missing = needed.filter((c) => !here.has(c.id)).map((c) => c.id);
    return buildReport({
      statuses,
      order: this.orderOf(needed, saved.first),
      run,
      saved,
      dependencies: (id) => dependenciesOf(this.options.manifest, id),
      space: await this.space(missing),
      held: plan.value.held.map((each) => ({ id: each.component.id, unlocks: each.unlocks })),
    });
  }

  async variantOf(id: string): AsyncResult<string> {
    const selection = await this.selection();
    if (!selection.ok) return ok(id);
    const chosen = variantHere(selection.value, id);
    return chosen.ok ? ok(chosen.value.id) : chosen;
  }

  /** Checks what this Mac needs and the disk, then starts a pass, or re-queues the running one. */
  private async begin(): AsyncResult<void> {
    const saved = await this.load();
    const needed = await this.needed(true);
    if (!needed.ok) return this.refuse(needed.error);
    const statuses = await this.options.manager.list();
    const here = new Set(statuses.filter((s) => s.state === 'installed').map((s) => s.id));
    const missing = needed.value.filter((c) => !here.has(c.id)).map((c) => c.id);
    const space = await this.options.manager.checkSpace(missing);
    if (!space.ok) return this.refuse(space.error);
    const running = this.run !== undefined && !this.run.stopped;
    const unfinished = saved.batch.some((id) => !here.has(id));
    const batch = running || unfinished ? [...new Set([...saved.batch, ...missing])] : missing;
    const { error: _cleared, ...rest } = saved;
    await this.save({ ...rest, batch });
    const order = this.orderOf(needed.value, saved.first);
    if (running && this.run) this.run.requeue(order);
    else this.launch(order, here);
    this.changed('state');
    return ok(undefined);
  }

  private launch(order: readonly string[], installed: ReadonlySet<string>): void {
    const run = new DownloadRun({
      manager: this.options.manager,
      order,
      installed,
      dependencies: (id) => dependenciesOf(this.options.manifest, id),
      lanes: this.options.lanes ?? DEFAULT_LANES,
      now: this.options.now ?? Date.now,
      onChange: (kind) => this.changed(kind),
    });
    this.run = run;
    void run.done.then(() => {
      if (this.run !== run) return;
      this.run = undefined;
      this.changed('state');
    });
    run.begin();
  }

  /** Stops the running pass, if any, and waits for its installs to let go. */
  private async halt(): Promise<void> {
    const run = this.run;
    this.run = undefined;
    await run?.stop();
    this.changed('state');
  }

  /** Remembers why it couldn't start, so a read after a restart still says. */
  private async refuse<T>(error: TaalcutError): Promise<Result<T>> {
    await this.save({ ...(await this.load()), error });
    this.changed('state');
    return err(error);
  }

  /** This machine, and whose terms the person hasn't accepted: what the selection (plan.ts) reads. */
  private async selection(say = false): AsyncResult<SelectionInput> {
    const fit = await this.options.machine();
    if (!fit.ok) return fit;
    const { manifest } = this.options;
    const log = say ? this.log : undefined;
    const unaccepted = await unacceptedTerms(manifest.components, this.options.terms, log);
    // Which build of each group runs here, and why the ones before it don't (ADR 0002: a CPU route says why).
    if (say) {
      const terms = termsHolds(manifest, unaccepted);
      for (const line of describeChoices(manifest, fit.value.tier, this.platform, fit.value, terms))
        this.log(line);
    }
    return ok({ manifest, platform: this.platform, fit: fit.value, unaccepted });
  }

  /** What the set fetches here and what waits on terms (plan.ts). */
  private async plan(say = false): AsyncResult<SetPlan> {
    const selection = await this.selection(say);
    return selection.ok ? planSet(selection.value) : selection;
  }

  /** The tier's picks on this machine (each variant group's member that runs here) with their dependencies. */
  private async needed(say = false): AsyncResult<readonly ComponentEntry[]> {
    const plan = await this.plan(say);
    return plan.ok ? ok(plan.value.needed) : plan;
  }

  private orderOf(needed: readonly ComponentEntry[], first: readonly string[]): string[] {
    const sizes = new Map(needed.map((c) => [c.id, selectArtifact(c, this.platform)?.size ?? 0]));
    return downloadOrder(needed, (id) => sizes.get(id) ?? 0, first);
  }

  /** What the rest needs on disk; an error carries the same numbers. */
  private async space(missing: readonly string[]): Promise<SpaceCheck> {
    const checked = await this.options.manager.checkSpace(missing);
    if (checked.ok) return checked.value;
    const { requiredBytes, availableBytes } = checked.error.params ?? {};
    return {
      requiredBytes: typeof requiredBytes === 'number' ? requiredBytes : 0,
      availableBytes: typeof availableBytes === 'number' ? availableBytes : undefined,
    };
  }

  /** The state when what this Mac needs can't be told (the tier, the manifest): the reason, no rows. */
  private unknown(error: TaalcutError): DownloadSetStatus {
    return {
      state: 'failed',
      entries: [],
      bytesTotal: 0,
      bytesDone: 0,
      bytesPerSecond: 0,
      requiredBytes: 0,
      error,
      awaitingTerms: [],
    };
  }

  private async load(): Promise<SavedDownloads> {
    this.saved ??= await this.file.read();
    return this.saved;
  }

  private async save(next: SavedDownloads): Promise<void> {
    this.saved = next;
    await this.file.write(next);
  }

  private changed(kind: 'progress' | 'state'): void {
    this.options.onChange?.(kind);
  }
}
