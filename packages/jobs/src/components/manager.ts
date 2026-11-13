// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The component manager (G13): install, update and remove downloadable
 * runtimes, models and tools. One instance owns one components folder; the
 * jobs utility process creates it and the job engine (P1-E1) will call
 * install() from a job. install() is already job-shaped: cancellable through
 * its signal, resumable after a kill (partial downloads survive), idempotent
 * (an installed component returns at once) and de-duplicated (concurrent calls
 * for one component share one download).
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { CancelledError, err, ok, type AsyncResult, type Result, type TaalcutError } from '@taalcut/core';
import { checkPlanSpace, DEFAULT_HEADROOM_BYTES, DiskBudget, nodeStatfs, type StatfsLike } from './disk';
import { ComponentRequired, ComponentUnknown, InstallFailed } from './errors';
import { describeCause } from './http';
import { installComponent, type InstallContext } from './install-one';
import { outdatedNotices, planOf, standingOf, type Standing } from './currency';
import { refreshNotice } from './notice-refresh';
import { JsonState, type StateLog } from './json-state';
import { componentLayout, idOfEntry, partPathFor, type ComponentLayout } from './layout';
import type { ComponentArtifact, ComponentEntry } from './manifest';
import type {
  ComponentManager,
  ComponentManagerOptions,
  InstallOptions,
  InstallPlan,
  SpaceCheck,
} from './manager-api';
import type { ComponentProgress } from './progress';
import { InstalledRegistry, type InstalledEntry } from './registry';
import { currentPlatform, dependentsOf, findComponent, installOrder, selectArtifact } from './selection';
import { SharedTask } from './shared-task';
import { refuseUnaccepted } from './terms';
import { WorkGate } from './work-gate';
import {
  componentStatus,
  FailureBook,
  FailuresFileSchema,
  installedView,
  NO_FAILURES,
  type ComponentStatus,
  type InstalledComponent,
} from './status';
import { fileSize, pathExists, removeQuietly } from './fs-util';
import { removeEntries, sweepDebris } from './sweep';

export type {
  ComponentManager,
  ComponentManagerOptions,
  InstallOptions,
  InstallPlan,
  SpaceCheck,
} from './manager-api';
export type { ComponentState, ComponentStatus, InstalledComponent } from './status';

/** What updateAll() brings up to the manifest: another version here, or this one with a replaced licence notice. */
const OUTDATED: ReadonlySet<ComponentStatus['state']> = new Set(['update_available', 'notice_outdated']);

export function createComponentManager(options: ComponentManagerOptions): ComponentManager {
  return new Manager(options);
}

class Manager implements ComponentManager {
  private readonly layout: ComponentLayout;
  private readonly platform: string;
  private readonly inflight = new Map<string, SharedTask<InstalledEntry, ComponentProgress>>();
  private readonly budget: DiskBudget;
  private readonly failures: FailureBook;
  private loading: Promise<InstalledRegistry> | undefined;
  /** Installs, updates, removes, cleanups and discards under way; closed by close(), which waits for them. */
  private readonly work = new WorkGate();
  /** The refresh of saved licence notices the manifest has replaced, while one runs. */
  private refreshing: Promise<void> | undefined;
  private readonly log: StateLog;

  constructor(private readonly options: ComponentManagerOptions) {
    this.layout = componentLayout(options.root);
    this.platform = options.platform ?? currentPlatform();
    this.budget = new DiskBudget(this.statfs);
    this.log = options.log ?? ((message: string) => console.warn(message));
    this.failures = new FailureBook(
      new JsonState(join(options.root, 'failures.json'), FailuresFileSchema, NO_FAILURES, this.log),
    );
  }

  async list(): Promise<ComponentStatus[]> {
    const registry = await this.ready();
    return Promise.all(
      this.options.manifest.components.map(async (component) => {
        const artifact = selectArtifact(component, this.platform);
        const entry = registry.get(component.id);
        const partPath =
          artifact && partPathFor(this.layout, component.id, component.version, artifact.sha256);
        return componentStatus({
          component,
          artifact,
          installed: entry && (await this.present(entry)) ? this.view(entry) : undefined,
          running: this.inflight.get(component.id),
          lastError: this.failures.get(component.id),
          partialBytes: partPath ? ((await fileSize(partPath)) ?? 0) : 0,
        });
      }),
    );
  }

  async get(id: string): Promise<InstalledComponent | undefined> {
    const entry = (await this.ready()).get(id);
    return entry && (await this.present(entry)) ? this.view(entry) : undefined;
  }

  async plan(ids: readonly string[]): AsyncResult<InstallPlan> {
    try {
      const order = installOrder(this.options.manifest, ids, this.platform);
      if (!order.ok) return order;
      return ok(await this.planFor(order.value));
    } catch (cause) {
      return err(InstallFailed({ component: ids.join(',') }, { detail: describeCause(cause) }));
    }
  }

  install(id: string, options: InstallOptions = {}): AsyncResult<InstalledComponent> {
    return this.work.run(() => this.installNow(id, options));
  }

  /**
   * The process is going away: every running install is aborted, then this resolves once each has let go of its
   * files and every state write asked so far has settled. Nothing writes after: see ComponentManager.close.
   */
  async close(): Promise<void> {
    const drained = this.work.close();
    for (const task of this.inflight.values()) task.cancel();
    // Callers' work winds down first (an install's last failure note, a remove's deletes), then the tasks'.
    await drained;
    await Promise.all([...this.inflight.values()].map((task) => task.result));
    // A registry that failed to load was never written to: nothing of it to wait for.
    const registry = await this.loading?.catch(() => undefined);
    await registry?.settled();
    await this.failures.settled();
  }

  private async installNow(id: string, options: InstallOptions): AsyncResult<InstalledComponent> {
    let order: Result<ComponentEntry[]>;
    let plan: InstallPlan;
    try {
      order = installOrder(this.options.manifest, [id], this.platform);
      if (!order.ok) return order;
      const refused = await refuseUnaccepted(order.value, this.options.terms, this.log);
      if (refused) return err(refused);
      plan = await this.planFor(order.value);
    } catch (cause) {
      return this.failed(id, InstallFailed({ component: id }, { detail: describeCause(cause) }));
    }
    // One check for the whole chain up front, so a big model fails before its runtime downloads. It
    // reserves the chain's bytes until each lands, so a concurrent install can't count them as free.
    const hold = await this.budget.reserve({
      path: this.layout.root,
      component: id,
      needs: plan.components.map((c) => ({ id: c.id, bytes: c.downloadBytes + c.extractBytes })),
      headroomBytes: this.headroom,
    });
    if (!hold.ok) return this.failed(id, hold.error);
    try {
      for (const step of plan.components) {
        // Closed between two parts of a chain: the next one doesn't start.
        if (this.work.closed) return err(CancelledError());
        const component = findComponent(this.options.manifest, step.id)!;
        const result = await (await this.taskFor(component)).join(options);
        await hold.value.release(step.id);
        // A dependency that stops the chain is this component's failure too: its row says why.
        if (!result.ok) return this.failed(id, result.error);
      }
    } finally {
      await hold.value.release();
    }
    const registry = await this.ready();
    const entry = registry.get(id);
    if (!entry) return this.failed(id, InstallFailed({ component: id }, { detail: 'not in the registry' }));
    await this.failures.clear(id);
    // The network answered: a notice whose refresh failed earlier gets another go.
    void this.refreshNoticesOf(registry);
    return ok(this.view(entry));
  }

  async refreshNotices(): Promise<void> {
    await this.refreshNoticesOf(await this.ready());
  }

  /**
   * Fetches the notice of every installed component whose files are current but whose saved licence notice the
   * manifest has replaced, each as its own task (a failure is its last error); close() waits for it. Asked again
   * while it runs, it is the same refresh.
   */
  private refreshNoticesOf(registry: InstalledRegistry): Promise<void> {
    this.refreshing ??= this.work
      .runQuietly(async () => {
        const stale = await outdatedNotices(this.options.manifest, (each) => this.standing(registry, each));
        await Promise.all(stale.map(async (component) => (await this.taskFor(component)).join()));
      })
      // A folder it can't read: the rows say what list() can, and the next load or install looks again.
      .catch((cause: unknown) => this.log(`[components] licence notices: ${describeCause(cause)}`))
      .finally(() => {
        this.refreshing = undefined;
      });
    return this.refreshing;
  }

  updateAll(options: InstallOptions = {}): AsyncResult<string[]> {
    return this.work.run(() => this.updateAllNow(options));
  }

  private async updateAllNow(options: InstallOptions): AsyncResult<string[]> {
    const outdated = (await this.list()).filter((s) => OUTDATED.has(s.state)).map((s) => s.id);
    for (const id of outdated) {
      const result = await this.install(id, options);
      if (!result.ok) return result;
    }
    return ok(outdated);
  }

  remove(id: string, options: { force?: boolean } = {}): AsyncResult<{ freedBytes: number }> {
    return this.work.run(() => this.removeNow(id, options));
  }

  private async removeNow(id: string, options: { force?: boolean }): AsyncResult<{ freedBytes: number }> {
    try {
      const registry = await this.ready();
      if (!findComponent(this.options.manifest, id) && !registry.get(id)) {
        return err(ComponentUnknown({ component: id }));
      }
      if (!options.force) {
        const dependent = dependentsOf(this.options.manifest, id).find((c) => registry.get(c.id));
        if (dependent) return err(ComponentRequired({ component: id, requiredBy: dependent.id }));
      }
      const running = this.inflight.get(id);
      if (running) {
        running.cancel();
        await running.result;
      }
      const removed = await registry.delete(id);
      await removeQuietly(join(this.layout.installedDir, id));
      await removeEntries(this.layout.downloadsDir, (name) => idOfEntry(name) === id);
      await removeEntries(this.layout.stagingDir, (name) => idOfEntry(name) === id);
      await this.failures.clear(id);
      return ok({ freedBytes: removed?.bytes ?? 0 });
    } catch (cause) {
      return err(InstallFailed({ component: id }, { detail: describeCause(cause) }));
    }
  }

  async cleanup(): Promise<void> {
    await this.work.runQuietly(async () => this.sweep(await this.ready()));
  }

  async checkSpace(ids: readonly string[]): AsyncResult<SpaceCheck> {
    const plan = await this.plan(ids);
    return plan.ok ? checkPlanSpace(plan.value, this.layout.root, this.statfs) : plan;
  }

  async settled(id: string): Promise<void> {
    const running = this.inflight.get(id);
    if (running?.aborted) await running.result;
  }

  async discardDownloads(id: string): Promise<void> {
    await this.work.runQuietly(async () => {
      await this.settled(id);
      if (this.inflight.has(id)) return;
      await this.ready();
      await removeEntries(this.layout.downloadsDir, (name) => idOfEntry(name) === id);
    });
  }

  /** Records why an install of `id` failed (not a cancellation) and returns the error. */
  private async failed<T>(id: string, error: TaalcutError): Promise<Result<T>> {
    await this.failures.note(id, error);
    return err(error);
  }

  private get headroom(): number {
    return this.options.headroomBytes ?? DEFAULT_HEADROOM_BYTES;
  }

  private get statfs(): StatfsLike {
    return this.options.statfs ?? nodeStatfs;
  }

  /**
   * Loads the registry once and sweeps debris from an earlier run. Retried if it fails. Closed before it ever
   * loaded, it only reads: a read after close() changes nothing on disk.
   */
  private ready(): Promise<InstalledRegistry> {
    this.loading ??= (async () => {
      const writes = !this.work.closed;
      if (writes)
        for (const dir of [this.layout.downloadsDir, this.layout.stagingDir, this.layout.installedDir]) {
          await mkdir(dir, { recursive: true });
        }
      const registry = await InstalledRegistry.load(this.layout.registryPath, this.options.now);
      await this.failures.load();
      if (writes) {
        await this.sweep(registry);
        // The manifest is loaded: saved notices it has since replaced are fetched now, alongside whatever runs.
        void this.refreshNoticesOf(registry);
      }
      return registry;
    })().catch((cause: unknown) => {
      this.loading = undefined;
      throw cause;
    });
    return this.loading;
  }

  private async planFor(order: readonly ComponentEntry[]): Promise<InstallPlan> {
    const registry = await this.ready();
    const { layout, platform, headroom: headroomBytes } = this;
    return planOf(order, { layout, platform, headroomBytes, standing: (c) => this.standing(registry, c) });
  }

  private async taskFor(component: ComponentEntry): Promise<SharedTask<InstalledEntry, ComponentProgress>> {
    let running = this.inflight.get(component.id);
    // A task whose last caller just left is still cleaning up; joining it would inherit its cancellation.
    while (running?.aborted) {
      await running.result;
      running = this.inflight.get(component.id);
    }
    if (running) return running;
    const artifact = selectArtifact(component, this.platform)!;
    const task = new SharedTask<InstalledEntry, ComponentProgress>(async (signal, emit) => {
      const result = await this.installWork(component, artifact, signal, emit);
      // Recorded before any caller hears the result, so a read right after sees it (and so does the next launch).
      await (result.ok ? this.failures.clear(component.id) : this.failures.note(component.id, result.error));
      return result;
    });
    this.inflight.set(component.id, task);
    // Closed while this caller waited above: close() already cancelled what was running, so this one stops too.
    if (this.work.closed) task.cancel();
    void task.result.then(() => {
      if (this.inflight.get(component.id) === task) this.inflight.delete(component.id);
    });
    return task;
  }

  private async installWork(
    component: ComponentEntry,
    artifact: ComponentArtifact,
    signal: AbortSignal,
    emit: (progress: ComponentProgress) => void,
  ): AsyncResult<InstalledEntry> {
    const registry = await this.ready();
    // Another caller may have finished this install between our plan and now.
    const { entry, currency } = await this.standing(registry, component);
    if (entry && currency === 'current') return ok(entry);
    const ctx: InstallContext = {
      layout: this.layout,
      registry,
      platform: this.platform,
      terms: this.options.terms,
      statfs: this.statfs,
      headroomBytes: this.headroom,
      download: { fetch: this.options.fetch, ...this.options.download },
      progressIntervalMs: this.options.progressIntervalMs,
      now: this.options.now ?? Date.now,
    };
    try {
      // Its files are current and only its licence notice isn't: that is all it fetches.
      if (entry && currency === 'notice') return await refreshNotice(ctx, component, entry, signal, emit);
      return await installComponent(ctx, component, artifact, signal, emit);
    } catch (cause) {
      return err(InstallFailed({ component: component.id }, { detail: describeCause(cause) }));
    }
  }

  /** What is installed of `component` and how it stands against the manifest. */
  private standing(registry: InstalledRegistry, component: ComponentEntry): Promise<Standing> {
    const artifact = selectArtifact(component, this.platform);
    return standingOf(registry.get(component.id), component, artifact, (entry) => this.present(entry));
  }

  /** True when the registry entry's folder is still on disk (the user may have deleted it). */
  private present(entry: InstalledEntry): Promise<boolean> {
    return pathExists(join(this.layout.root, entry.dir, entry.file ?? ''));
  }

  private view(entry: InstalledEntry): InstalledComponent {
    return installedView(this.layout.root, entry);
  }

  private sweep(registry: InstalledRegistry): Promise<void> {
    return sweepDebris({
      layout: this.layout,
      registry,
      manifest: this.options.manifest,
      platform: this.platform,
      busy: (id) => this.inflight.has(id),
    });
  }
}
