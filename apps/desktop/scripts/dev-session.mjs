// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * When `pnpm dev` (scripts/dev.mjs) starts Electron again, kept apart from Electron and tsdown so it is unit-tested.
 *
 * tsdown builds four configs in watch mode, each on its own watcher. A rebuild first deletes that config's files in
 * out/ (a config reload deletes all of out/), and the configs finish at different times: one change to a module they
 * all bundle rebuilt preload in 350 ms and main a second later. Restarting 200 ms after the first config's success
 * started Electron while out/main/index.mjs was gone, and its "Cannot find module" exit ended the whole session
 * (UX3-IDX, 2026-10-27). So:
 * - a config that starts a build (its `buildStart`, rebuildTracker) holds the restart until it succeeds;
 * - Electron starts again only when no config is building, each has built once and every file the app loads is on
 *   disk, after a short settle (one change starts several configs a few milliseconds apart);
 * - an exit that isn't a quit (a launch that failed, a crash) keeps the session watching: the next rebuild starts it;
 * - quitting the app (exit code 0) or stopping dev.mjs (Ctrl-C) ends the session.
 */

/** tsdown.config.ts's configs, by name. */
export const DEV_CONFIGS = ['main', 'preload', 'utility', 'placeholder'];

/** Every entry file the configs write under out/ (test/dev-session.test.ts checks them against tsdown.config.ts). */
export const DEV_OUTPUTS = [
  'main/index.mjs',
  'preload/index.cjs',
  'utility/agent.mjs',
  'utility/jobs.mjs',
  'utility/render.mjs',
  'utility/lan.mjs',
  'utility/mcp.mjs',
  'utility/shot-model.mjs',
  'placeholder/probe.mjs',
];

/**
 * What the watchers leave alone: third-party code. pnpm hard-links node_modules/.pnpm's files from one store that
 * every worktree on the machine shares, so a `pnpm install` in another worktree changes the link count of files this
 * bundle reads. inotify reports that as a change (IN_ATTRIB) with no byte changed, rolldown rebuilds every config
 * that bundles the file, and gaxios' and google-auth-library's package.json (main imports both for their version)
 * match tsdown's config-file pattern, which reloads everything and empties out/. Restart `pnpm dev` after an
 * install of your own instead.
 */
export const IGNORED_BY_WATCH = /[\\/]node_modules[\\/]/;

/** How long the configs must stay quiet before Electron starts again. */
export const SETTLE_MS = 200;

/** How long a stopped session waits for Electron to quit before it exits anyway. */
export const STOP_GRACE_MS = 5000;

/**
 * A tsdown plugin that reports each config's build start to the session. tsdown hands every config the same plugin
 * object, so once a config is resolved this adds a rolldown plugin of its own, which knows the config's name.
 */
export function rebuildTracker(session) {
  return {
    name: 'taalcut:dev-rebuilds',
    tsdownConfigResolved(config) {
      const name = config.name ?? config.outDir;
      const starts = { name: `taalcut:dev-rebuild-start:${name}`, buildStart: () => session.started(name) };
      config.plugins = [config.plugins, starts];
    },
  };
}

export function createDevSession({
  ready,
  launch,
  exit,
  log = () => {},
  configs = DEV_CONFIGS,
  settleMs = SETTLE_MS,
  timers = { set: setTimeout, clear: clearTimeout },
}) {
  const building = new Set();
  const built = new Set();
  let app;
  /** The running app was asked to quit so a new build can start. */
  let replacing = false;
  let stopping;
  let timer;

  const settled = () => building.size === 0 && configs.every((name) => built.has(name)) && ready();

  function start() {
    const child = launch();
    app = child;
    child.once('error', (error) => onExit(child, null, null, error));
    child.once('exit', (code, signal) => onExit(child, code, signal));
  }

  function onExit(child, code, signal, error) {
    if (child !== app) return;
    app = undefined;
    if (stopping !== undefined) return exit(stopping);
    if (replacing) {
      replacing = false;
      if (settled()) return start();
      return log('waiting for the build to finish before starting the app');
    }
    if (code === 0) {
      log('the app quit: ending the dev session');
      return exit(0);
    }
    const why = error ? error.message : signal ? `signal ${signal}` : `code ${code}`;
    log(`the app exited (${why}); still watching: it starts again after the next rebuild`);
  }

  /** The settle is over: start the app, or replace the running one, when nothing is building. */
  function fire() {
    timer = undefined;
    if (stopping !== undefined || !settled()) return;
    if (!app) return start();
    if (replacing) return;
    // The new app starts once the old one is gone, or the single-instance lock makes it quit.
    replacing = true;
    app.kill();
  }

  function schedule() {
    if (timer !== undefined) timers.clear(timer);
    timer = undefined;
    if (stopping === undefined && settled()) timer = timers.set(fire, settleMs);
  }

  return {
    /** A config began a build: its files in out/ are about to go. */
    started(name) {
      building.add(name);
      if (timer !== undefined) timers.clear(timer);
      timer = undefined;
    },
    /** A config's build succeeded and its files are written. */
    built(name) {
      building.delete(name);
      built.add(name);
      schedule();
    },
    /** dev.mjs was stopped: the app quits, then the session exits with `code`. */
    stop(code) {
      if (stopping !== undefined) return;
      stopping = code;
      if (timer !== undefined) timers.clear(timer);
      if (!app) return exit(code);
      app.kill();
      timers.set(() => exit(code), STOP_GRACE_MS);
    },
    /** For tests and logs. */
    get state() {
      return { building: [...building], built: [...built], running: app !== undefined, replacing };
    },
  };
}
