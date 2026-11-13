// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One pass of the download of everything this Mac needs: up to `lanes` installs at a time, in the download order,
 * each started only once what it depends on is installed. A component that fails is recorded by the manager (its
 * last error, kept across restarts) and the others carry on; what depends on it can't install, so it waits out this pass. The pass ends when nothing
 * runs and nothing more can start. Stopping it (pause, cancel, the process going away) aborts every install; their
 * partial downloads stay on disk for the next pass.
 */
import type { ComponentManager } from '../manager-api';
import { SpeedMeter, type ComponentProgress } from '../progress';

export interface RunOptions {
  readonly manager: Pick<ComponentManager, 'install' | 'settled'>;
  /** The components to install, in the order to start them. */
  readonly order: readonly string[];
  /** Components already installed (dependencies count as met). */
  readonly installed: ReadonlySet<string>;
  /** Direct and indirect dependencies of a component. */
  readonly dependencies: (id: string) => readonly string[];
  readonly lanes: number;
  readonly now: () => number;
  /** Something moved: `progress` for bytes, `state` when a component starts or ends. */
  readonly onChange: (kind: 'progress' | 'state') => void;
}

export class DownloadRun {
  private readonly controller = new AbortController();
  private readonly active = new Map<string, Promise<void>>();
  private readonly progress = new Map<string, ComponentProgress>();
  private readonly installed: Set<string>;
  private queue: string[];
  private readonly meter = new SpeedMeter();
  /** Bytes received in this pass, for its speed; and each download's last count, to add only what is new. */
  private fetched = 0;
  private readonly seen = new Map<string, number>();
  private settle: (() => void) | undefined;
  /** Resolves when the pass is over: everything it could install is, or it was stopped. */
  readonly done: Promise<void>;

  constructor(private readonly options: RunOptions) {
    this.installed = new Set(options.installed);
    this.queue = options.order.filter((id) => !this.installed.has(id));
    this.done = new Promise((resolve) => (this.settle = resolve));
  }

  /** Starts what can start. Call once; `requeue` adds work while it runs. */
  begin(): void {
    this.pump();
  }

  get stopped(): boolean {
    return this.controller.signal.aborted;
  }

  isActive(id: string): boolean {
    return this.active.has(id);
  }

  isQueued(id: string): boolean {
    return this.queue.includes(id);
  }

  progressOf(id: string): ComponentProgress | undefined {
    return this.active.has(id) ? this.progress.get(id) : undefined;
  }

  /** Over this pass's downloads, the last few seconds. */
  bytesPerSecond(): number {
    return this.meter.bytesPerSecond(this.options.now(), this.fetched);
  }

  /**
   * Puts these components back in line in this order (a retry, or what goes first changed): those not running
   * and not installed are queued again, ahead of nothing they depend on.
   */
  requeue(order: readonly string[]): void {
    if (this.stopped) return;
    this.queue = order.filter((id) => !this.installed.has(id) && !this.active.has(id));
    this.options.onChange('state');
    this.pump();
  }

  /** Aborts every install and waits for them to let go of their files. */
  async stop(): Promise<void> {
    this.controller.abort();
    this.queue = [];
    const ids = [...this.active.keys()];
    await Promise.all(this.active.values());
    await Promise.all(ids.map((id) => this.options.manager.settled(id)));
    this.finishIfIdle();
  }

  private pump(): void {
    while (!this.stopped && this.active.size < this.options.lanes) {
      const next = this.queue.find((id) => this.ready(id));
      if (next === undefined) break;
      this.queue = this.queue.filter((id) => id !== next);
      this.active.set(next, this.install(next));
    }
    this.finishIfIdle();
  }

  /** Everything it depends on is installed. One whose dependency failed waits for the next pass. */
  private ready(id: string): boolean {
    return this.options.dependencies(id).every((dep) => this.installed.has(dep));
  }

  private finishIfIdle(): void {
    if (this.active.size > 0) return;
    const startable = !this.stopped && this.queue.some((id) => this.ready(id));
    if (!startable) this.settle?.();
  }

  private async install(id: string): Promise<void> {
    this.options.onChange('state');
    const result = await this.options.manager.install(id, {
      signal: this.controller.signal,
      onProgress: (progress) => this.note(id, progress),
    });
    this.active.delete(id);
    this.progress.delete(id);
    this.seen.delete(id);
    if (result.ok) this.installed.add(id);
    this.options.onChange('state');
    this.pump();
  }

  private note(id: string, progress: ComponentProgress): void {
    // The install's progress covers its dependencies too; this pass installs those in their own lanes.
    if (progress.componentId !== id) return;
    this.progress.set(id, progress);
    if (progress.phase === 'downloading' && progress.retry === undefined) {
      const before = this.seen.get(id);
      // A first count is what was on disk already; a smaller one is a restart from zero.
      if (before !== undefined && progress.bytesDone > before) this.fetched += progress.bytesDone - before;
      this.seen.set(id, progress.bytesDone);
      this.meter.add(this.options.now(), this.fetched);
    }
    this.options.onChange('progress');
  }
}
