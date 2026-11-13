// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX3-IDX: when `pnpm dev` starts Electron again (scripts/dev-session.mjs). A rebuild that reaches several configs
 * restarts once, after the last of them succeeds and every file the app loads is back in out/; an app that fails to
 * start or crashes leaves the session watching until the next rebuild; quitting the app or stopping dev.mjs ends it.
 * The watchers ignore node_modules, whose hard links another worktree's `pnpm install` touches.
 */
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  createDevSession,
  DEV_CONFIGS,
  DEV_OUTPUTS,
  IGNORED_BY_WATCH,
  rebuildTracker,
  SETTLE_MS,
  STOP_GRACE_MS,
} from '../scripts/dev-session.mjs';
import configs from '../tsdown.config';

class FakeApp extends EventEmitter {
  killed = false;
  kill() {
    this.killed = true;
    return true;
  }
  quit(code: number | null, signal: NodeJS.Signals | null = null) {
    this.emit('exit', code, signal);
  }
}

/** A session over fake timers and apps; `files` says whether out/ is complete. */
function harness() {
  const timers = new Map<number, { run: () => void; ms: number }>();
  let next = 0;
  const apps: FakeApp[] = [];
  const exits: number[] = [];
  const logs: string[] = [];
  const out = { complete: true };
  const session = createDevSession({
    ready: () => out.complete,
    launch: () => {
      const app = new FakeApp();
      apps.push(app);
      return app;
    },
    exit: (code) => exits.push(code),
    log: (message) => logs.push(message),
    timers: {
      set: (run, ms) => {
        timers.set(++next, { run, ms });
        return next;
      },
      clear: (handle) => timers.delete(handle as number),
    },
  });
  /** Runs the timers that are due now (the settle; the stop's grace when asked). */
  const tick = (upTo = SETTLE_MS) => {
    for (const [id, timer] of [...timers]) {
      if (timer.ms > upTo) continue;
      timers.delete(id);
      timer.run();
    }
  };
  const buildAll = () => DEV_CONFIGS.forEach((name) => session.built(name));
  return { session, apps, exits, logs, out, tick, buildAll, timers };
}

describe('the dev session', () => {
  it('starts the app once every config has built and every output is on disk', () => {
    const { session, apps, tick, out } = harness();
    DEV_CONFIGS.forEach((name) => session.started(name));
    session.built('preload');
    session.built('placeholder');
    tick();
    expect(apps).toHaveLength(0);
    out.complete = false;
    session.built('main');
    session.built('utility');
    tick();
    expect(apps).toHaveLength(0);
    out.complete = true;
    session.built('utility');
    tick();
    expect(apps).toHaveLength(1);
  });

  it('restarts once after a rebuild that reaches several configs, when the last of them succeeds', () => {
    const { session, apps, tick, buildAll } = harness();
    buildAll();
    tick();
    const first = apps[0]!;
    // One change to a module every config bundles: preload succeeds while main is still rebuilding (its files gone).
    ['preload', 'main', 'utility'].forEach((name) => session.started(name));
    session.built('preload');
    tick();
    expect(first.killed).toBe(false);
    session.built('utility');
    tick();
    expect(first.killed).toBe(false);
    session.built('main');
    tick();
    expect(first.killed).toBe(true);
    // The new app starts only once the old one is gone (the single-instance lock).
    expect(apps).toHaveLength(1);
    first.quit(null, 'SIGTERM');
    expect(apps).toHaveLength(2);
  });

  it('a build that starts during the settle, or while the old app quits, holds the launch until it succeeds', () => {
    const { session, apps, tick, buildAll } = harness();
    buildAll();
    session.started('main');
    tick();
    expect(apps).toHaveLength(0);
    session.built('main');
    tick();
    const first = apps[0]!;
    session.built('utility');
    tick();
    session.started('main');
    first.quit(null, 'SIGTERM');
    expect(apps).toHaveLength(1);
    session.built('main');
    tick();
    expect(apps).toHaveLength(2);
  });

  it('keeps watching after a launch that fails, and starts the app again on the next rebuild', () => {
    const { session, apps, exits, logs, tick, buildAll } = harness();
    buildAll();
    tick();
    // Electron's "Unable to find Electron app … Cannot find module …/out/main/index.mjs".
    apps[0]!.quit(1);
    expect(exits).toEqual([]);
    expect(logs.at(-1)).toMatch(/exited \(code 1\); still watching/);
    expect(session.state.running).toBe(false);
    session.started('main');
    session.built('main');
    tick();
    expect(apps).toHaveLength(2);
    // A crash by signal, or Electron that can't be spawned at all, is the same.
    apps[1]!.quit(null, 'SIGSEGV');
    session.built('main');
    tick();
    apps[2]!.emit('error', new Error('spawn ENOENT'));
    expect(exits).toEqual([]);
    expect(logs.at(-1)).toMatch(/spawn ENOENT/);
  });

  it('ends the session when the app quits', () => {
    const { apps, exits, logs, tick, buildAll } = harness();
    buildAll();
    tick();
    apps[0]!.quit(0);
    expect(exits).toEqual([0]);
    expect(logs.at(-1)).toMatch(/the app quit/);
  });

  it('stopping dev.mjs quits the app and exits with the code, or after the grace when the app hangs', () => {
    const quits = harness();
    quits.buildAll();
    quits.tick();
    quits.session.stop(130);
    expect(quits.apps[0]!.killed).toBe(true);
    quits.apps[0]!.quit(null, 'SIGTERM');
    expect(quits.exits).toEqual([130]);

    const hangs = harness();
    hangs.buildAll();
    hangs.tick();
    hangs.session.stop(143);
    hangs.tick(STOP_GRACE_MS);
    expect(hangs.exits).toEqual([143]);

    const idle = harness();
    idle.session.stop(130);
    expect(idle.exits).toEqual([130]);
    idle.buildAll();
    idle.tick();
    expect(idle.apps).toHaveLength(0);
  });
});

describe('the watch options', () => {
  it('reports each config’s build start under its own name', () => {
    const started: string[] = [];
    const tracker = rebuildTracker({ started: (name) => started.push(name) });
    const resolved = DEV_CONFIGS.map((name) => ({
      name,
      outDir: `out/${name}`,
      plugins: [{ name: 'theirs' }],
    }));
    for (const config of resolved) tracker.tsdownConfigResolved(config);
    for (const config of resolved) {
      const [theirs, ours] = config.plugins as [unknown, { buildStart: () => void }];
      expect(theirs).toEqual([{ name: 'theirs' }]);
      ours.buildStart();
    }
    expect(started).toEqual(DEV_CONFIGS);
  });

  it('ignores node_modules (pnpm’s shared hard links) but not the workspace’s sources', () => {
    const store = '/w/idx/node_modules/.pnpm/gaxios@7.3.1/node_modules/gaxios/package.json';
    expect(IGNORED_BY_WATCH.test(store)).toBe(true);
    expect(IGNORED_BY_WATCH.test('C:\\w\\node_modules\\.pnpm\\zod@4.6.5\\node_modules\\zod\\index.js')).toBe(
      true,
    );
    expect(IGNORED_BY_WATCH.test('/w/idx/packages/library/src/indexing/status.ts')).toBe(false);
    expect(IGNORED_BY_WATCH.test('/w/idx/apps/desktop/package.json')).toBe(false);
  });

  it('waits for every entry tsdown.config.ts writes', () => {
    const list = Array.isArray(configs) ? configs : [configs];
    const written = list.flatMap((config) => {
      const dir = String(config.outDir).replace(/^out\//, '');
      const ext = config.format === 'cjs' ? 'cjs' : 'mjs';
      return Object.keys(config.entry as Record<string, string>).map((entry) => `${dir}/${entry}.${ext}`);
    });
    expect([...DEV_OUTPUTS].sort()).toEqual(written.sort());
    expect(list.map((config) => config.name)).toEqual(DEV_CONFIGS);
  });
});
