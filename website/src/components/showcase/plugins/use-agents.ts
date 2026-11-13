// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/**
 * Settings › External agents' state: the switch (off by default in the app), the Connect an agent form (which app,
 * what it may do), the agents connected (waiting for it to connect, connected, revoked), and an export one of them
 * asked for, which still waits for you. The one orchestrated arrival turns it on, connects Claude Code, shows its
 * export waiting for you and lights the level you gave it; the server's HTML and reduced motion show that end.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { useArrival } from '../use-arrival';
import type { AgentApp, AgentLevel } from './plugins-data';

export interface AgentSession {
  readonly id: number;
  readonly app: AgentApp;
  readonly status: 'waiting' | 'connected' | 'revoked';
  readonly level: AgentLevel;
}

/** The export an agent asked for: waiting for you, or your answer. */
export type RequestStatus = 'waiting' | 'approved' | 'declined';

const FIRST: AgentSession = { id: 1, app: 'claude-code', status: 'connected', level: 'export' };

export function useAgents({ autoplay }: { readonly autoplay: boolean }) {
  const reduce = useReducedMotionPref();
  const [box, phase] = useArrival<HTMLDivElement>(0.35, 0.6);
  const [on, setOn] = useState(true);
  const [app, setApp] = useState<AgentApp>('claude-code');
  const [level, setLevel] = useState<AgentLevel>('read');
  const [copied, setCopied] = useState<AgentApp | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [sessions, setSessions] = useState<readonly AgentSession[]>([FIRST]);
  const [request, setRequest] = useState<{ readonly session: number; readonly status: RequestStatus } | null>({
    session: 1,
    status: 'waiting',
  });
  const [said, setSaid] = useState<Readonly<Record<number, string>>>({});
  /** Rows and cards added in this browser rise in; the server's never do. */
  const [grown, setGrown] = useState(false);
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
  const patch = useCallback((id: number, change: Partial<AgentSession>) => {
    setSessions((now) => now.map((s) => (s.id === id ? { ...s, ...change } : s)));
  }, []);

  const start = useCallback(() => {
    clear();
    setGrown(true);
    setRunning(true);
    setOn(false);
    setApp('claude-code');
    setLevel('read');
    setCopied(null);
    setConnecting(false);
    setSessions([]);
    setRequest(null);
    setSaid({});
  }, [clear]);

  /** Connect an agent: Taalcut copies the setup; the agent shows, waiting, then connects once it is pasted. */
  const connect = useCallback(
    (which: AgentApp, at: AgentLevel, id: number, fast: boolean) => {
      setConnecting(true);
      later(fast ? 0 : 450, () => {
        setConnecting(false);
        setCopied(which);
        setSessions((now) => [{ id, app: which, status: 'waiting', level: at }, ...now]);
      });
      later(fast ? 0 : 1250, () => patch(id, { status: 'connected' }));
    },
    [later, patch],
  );

  /**
   * The arrival, under 3 s: turn it on, connect Claude Code; its ask arrives as a message, waiting for you, while the
   * level you gave it steps from Read to Edit to Export.
   */
  const replay = useCallback(() => {
    start();
    later(200, () => setOn(true));
    later(350, () => connect('claude-code', 'read', 1, false));
    later(1700, () => setRequest({ session: 1, status: 'waiting' }));
    later(2150, () => patch(1, { level: 'edit' }));
    later(2550, () => {
      patch(1, { level: 'export' });
      setRunning(false);
    });
  }, [start, later, connect, patch]);

  useEffect(() => {
    if (!autoplay) return;
    if (phase === 'waiting') start();
    else if (phase === 'play') replay();
  }, [autoplay, phase, replay, start]);
  useEffect(() => clear, [clear]);

  const next = sessions.reduce((n, s) => Math.max(n, s.id), 0) + 1;

  return {
    box,
    reduce,
    on,
    app,
    level,
    copied,
    connecting,
    sessions,
    request,
    said,
    grown,
    running,
    replay,
    setOn: (value: boolean) => {
      clear();
      setRunning(false);
      setConnecting(false);
      setOn(value);
    },
    setApp: (value: AgentApp) => {
      setApp(value);
      setCopied(null);
    },
    setLevel,
    connect: () => {
      if (connecting) return;
      clear();
      setRunning(false);
      setGrown(true);
      connect(app, level, next, reduce);
    },
    setSessionLevel: (id: number, value: AgentLevel) => {
      clear();
      setRunning(false);
      patch(id, { level: value });
    },
    answer: (status: Exclude<RequestStatus, 'waiting'>) => setRequest((now) => (now ? { ...now, status } : now)),
    revoke: (id: number) => {
      clear();
      setRunning(false);
      patch(id, { status: 'revoked' });
      setRequest((now) => (now && now.session === id && now.status === 'waiting' ? null : now));
      setSaid((now) => ({ ...now, [id]: 'Revoked. It can’t act any more.' }));
    },
  };
}

export type Agents = ReturnType<typeof useAgents>;
