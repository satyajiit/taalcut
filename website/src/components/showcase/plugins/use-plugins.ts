// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/**
 * Settings › Plugins' state, shared by the showcase and the features index's fragment: the plugin open and its view,
 * and each plugin's connection (its credential saved, the connection tested), the access given and whether the AI may
 * use it. The one orchestrated arrival connects Instagram Edits (import the token, test, give access, turn it on);
 * the server's HTML and reduced motion show it done.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { useArrival } from '../use-arrival';
import { type PluginId, type PluginViewId, PLUGINS, pluginById } from './plugins-data';

export interface PluginState {
  readonly saved: boolean;
  readonly tested: boolean;
  readonly granted: ReadonlySet<string>;
  readonly enabled: boolean;
}

type States = Readonly<Record<PluginId, PluginState>>;

/** Both connected and on: Postiz without uploads, Instagram Edits with all three kinds of access. */
const DONE: States = {
  postiz: { saved: true, tested: true, granted: new Set(['channels-read', 'posts-read', 'posts-write', 'analytics-read']), enabled: true },
  'instagram-edits': { saved: true, tested: true, granted: new Set(pluginById('instagram-edits').access.map((a) => a.id)), enabled: true },
};
const FRESH: PluginState = { saved: false, tested: false, granted: new Set(), enabled: false };

/** The words for a plugin's state, as its status chip says them (plugin-status.tsx). */
export function statusOf(state: PluginState): 'Active' | 'Inactive' | 'Not connected' {
  return state.enabled ? 'Active' : state.saved ? 'Inactive' : 'Not connected';
}

export type PluginWork = 'import' | 'test' | null;

export function usePlugins({ autoplay }: { readonly autoplay: boolean }) {
  const reduce = useReducedMotionPref();
  const [box, phase] = useArrival<HTMLDivElement>(0.35, 0.6);
  const [open, setOpen] = useState<PluginId>('instagram-edits');
  const [view, setView] = useState<PluginViewId>('access');
  const [states, setStates] = useState<States>(DONE);
  const [work, setWork] = useState<PluginWork>(null);
  const [skill, setSkill] = useState<string | null>(null);
  /** The page changed in this browser, so the next view rises in (the server's view never does). */
  const [moved, setMoved] = useState(false);
  /** The arrival is waiting or playing (data-run on the page). */
  const [running, setRunning] = useState(false);
  const timers = useRef<number[]>([]);

  const clear = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);
  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  const patch = useCallback((id: PluginId, change: (s: PluginState) => Partial<PluginState>) => {
    setStates((now) => ({ ...now, [id]: { ...now[id], ...change(now[id]) } }));
  }, []);

  const start = useCallback(() => {
    clear();
    setMoved(true);
    setRunning(true);
    setOpen('postiz');
    setView('connection');
    setWork(null);
    setStates({ ...DONE, 'instagram-edits': FRESH });
  }, [clear]);

  /** The arrival: open Instagram Edits, import its token, test it, give access, then let the AI use it. */
  const replay = useCallback(() => {
    start();
    const edits: PluginId = 'instagram-edits';
    later(350, () => setOpen(edits));
    later(900, () => setWork('import'));
    later(1350, () => {
      setWork(null);
      patch(edits, () => ({ saved: true }));
    });
    later(1650, () => setWork('test'));
    later(2050, () => {
      setWork(null);
      patch(edits, () => ({ tested: true }));
    });
    later(2400, () => setView('access'));
    pluginById(edits).access.forEach((a, i) =>
      later(2700 + i * 220, () => patch(edits, (s) => ({ granted: new Set(s.granted).add(a.id) }))),
    );
    later(3500, () => {
      patch(edits, () => ({ enabled: true }));
      setRunning(false);
    });
  }, [start, later, patch]);

  useEffect(() => {
    if (!autoplay) return;
    if (phase === 'waiting') start();
    else if (phase === 'play') replay();
  }, [autoplay, phase, replay, start]);
  useEffect(() => clear, [clear]);

  const busy = (kind: Exclude<PluginWork, null>, done: () => void) => {
    clear();
    setRunning(false);
    setWork(kind);
    later(reduce ? 0 : 500, () => {
      setWork(null);
      done();
    });
  };

  return {
    box,
    reduce,
    plugins: PLUGINS,
    open,
    plugin: pluginById(open),
    view,
    state: states[open],
    stateOf: (id: PluginId) => states[id],
    work,
    skill,
    moved,
    running,
    replay,
    choose: (id: PluginId) => {
      clear();
      setRunning(false);
      setWork(null);
      setMoved(true);
      setOpen(id);
      setSkill(null);
    },
    setView: (next: PluginViewId) => {
      clear();
      setRunning(false);
      setWork(null);
      setMoved(true);
      setView(next);
    },
    importKey: () => busy('import', () => patch(open, () => ({ saved: true, tested: false }))),
    test: () => busy('test', () => patch(open, () => ({ tested: true }))),
    grant: (access: string, on: boolean) =>
      patch(open, (s) => {
        const granted = new Set(s.granted);
        if (on) granted.add(access);
        else granted.delete(access);
        return { granted };
      }),
    setEnabled: (on: boolean) => patch(open, (s) => ({ enabled: on && s.saved })),
    toggleSkill: (name: string) => setSkill((now) => (now === name ? null : name)),
  };
}

export type Plugins = ReturnType<typeof usePlugins>;
