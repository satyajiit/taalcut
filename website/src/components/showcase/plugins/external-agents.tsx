// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: Settings › External agents · mode: Operate · system: WEB2 Remix Vernacular (teal is your choice;
 *   danger ink on a secondary button for Revoke; no marigold: the page's one fill is its waitlist button)
 * the settings behind the ask (at-work.tsx), kept compact: the switch that lets agents on this Mac use Taalcut (off
 *   by default) and the server's state in words; Connect an agent: Which app? (Claude Code or Codex, each its SVGL
 *   icon), what it may do (Look only, Edit, Edit and export, its line under it), Connect and copy setup, then where
 *   to paste it; Connected agents: each its app, its state (Waiting for it to connect, Connected, Revoked), what it
 *   may do, how many asks wait for you, and Revoke access ("Revoked. It can't act any more.").
 * states: switch: off (the form waits) · on (listening) · Which app: chosen (aria-checked, raised) · hover · focus ·
 *   connect: default · working (its words, aria-busy) · copied (where to paste, announced) · session: waiting ·
 *   connected · revoked (greyed, its controls gone, said once) · an ask waiting (1 waiting for you)
 * motion: a new agent's row rises 6 px and fades in; reduced motion: at once */

import { Bot, CircleCheck, CircleOff, Clock, Link2, PlugZap } from 'lucide-react';
import { motion } from 'motion/react';
import { useRef, type KeyboardEvent } from 'react';
import { BrandIcon } from '#components/brand/brand-icon';
import { buttonClasses } from '#components/ui/button-classes';
import { cn } from '#lib/cn';
import { EASE_OUT } from '#lib/motion';
import { Chip } from '../chip';
import { Segmented } from '../segmented';
import { SwitchRow } from './controls';
import { ViewHeading } from './plugin-views';
import { AGENT_APPS, AGENT_LEVELS, AGENT_WORDS, type AgentApp, type AgentLevel } from './plugins-data';
import type { AgentSession, Agents } from './use-agents';

const LEVEL_OPTIONS = AGENT_LEVELS.map((l) => ({ value: l.id, label: l.name }));
const appOf = (id: AgentApp) => AGENT_APPS.find((a) => a.id === id) ?? AGENT_APPS[0]!;
const lineOf = (id: AgentLevel) => AGENT_LEVELS.find((l) => l.id === id)?.line ?? '';

/** Which app?: Claude Code or Codex, a radio group with each app's icon. */
function AppChoice({ value, onChange }: { readonly value: AgentApp; readonly onChange: (app: AgentApp) => void }) {
  const list = useRef<HTMLDivElement>(null);
  const choose = (app: AgentApp) => {
    onChange(app);
    list.current?.querySelector<HTMLElement>(`[data-app="${app}"]`)?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const at = AGENT_APPS.findIndex((a) => a.id === value);
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    const target = event.key === 'Home' ? AGENT_APPS[0] : event.key === 'End' ? AGENT_APPS.at(-1) : AGENT_APPS[(at + step + AGENT_APPS.length) % AGENT_APPS.length];
    if (target) choose(target.id);
  };
  return (
    <div ref={list} role="radiogroup" aria-label="Which app?" onKeyDown={onKeyDown} className="flex flex-wrap gap-2">
      {AGENT_APPS.map((a) => {
        const chosen = a.id === value;
        return (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={chosen}
            data-app={a.id}
            tabIndex={chosen ? 0 : -1}
            onClick={() => choose(a.id)}
            className={cn(
              'inline-flex h-10 items-center rounded-pill border px-3.5 type-label transition-colors duration-(--dur-micro) ease-(--ease-out) active:bg-pressed',
              chosen ? 'border-teal-strong bg-teal-soft text-ink' : 'border-rule bg-control text-ink-2 hover:bg-control-hover hover:text-ink',
            )}
          >
            <span data-slot="icon-text" className="inline-flex items-center gap-2">
              <BrandIcon id={a.brand} className="size-4" />
              {a.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SessionStatus({ session }: { readonly session: AgentSession }) {
  if (session.status === 'revoked')
    return (
      <Chip>
        <CircleOff aria-hidden /> Revoked
      </Chip>
    );
  return session.status === 'connected' ? (
    <Chip tone="success">
      <CircleCheck aria-hidden /> {AGENT_WORDS.connected}
    </Chip>
  ) : (
    <Chip>
      <Clock aria-hidden /> {AGENT_WORDS.waiting}
    </Chip>
  );
}

function SessionRow({ session, shown }: { readonly session: AgentSession; readonly shown: Agents }) {
  const app = appOf(session.app);
  const gone = session.status === 'revoked';
  const request = shown.request?.session === session.id ? shown.request : null;
  return (
    <motion.li
      data-session={session.status}
      className={cn('flex flex-col gap-3 border-t border-rule-subtle py-3.5 first:border-t-0', gone && 'text-ink-3')}
      initial={shown.grown && !shown.reduce ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE_OUT }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span data-slot="icon-text" className={cn('inline-flex items-center gap-2 type-card-title', gone ? 'text-ink-2' : 'text-ink')}>
          <BrandIcon id={app.brand} className={cn('size-4', gone && 'opacity-50')} />
          {app.name}
        </span>
        <SessionStatus session={session} />
        {request?.status === 'waiting' ? <span className="type-label-sm text-ink">1 waiting for you</span> : null}
      </div>
      {gone ? null : (
        <>
          <div className="flex flex-col gap-1.5">
            <Segmented
              label={`What ${app.name} may do`}
              options={LEVEL_OPTIONS}
              value={session.level}
              onChange={(value) => shown.setSessionLevel(session.id, value)}
            />
            <p className="m-0 type-meta text-ink-2">{lineOf(session.level)}</p>
          </div>
          <div>
            <button
              type="button"
              onClick={() => shown.revoke(session.id)}
              className={buttonClasses('secondary', 'md', 'text-danger-strong! hover:text-danger-strong!')}
            >
              Revoke access
            </button>
          </div>
        </>
      )}
      <p role="status" className="m-0 type-body text-ink empty:hidden">
        {shown.said[session.id] ?? ''}
      </p>
    </motion.li>
  );
}

export function ExternalAgents({ shown }: { readonly shown: Agents }) {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <ViewHeading icon={Bot} title="Agents on this Mac" />
        <SwitchRow label={AGENT_WORDS.switchLabel} description={AGENT_WORDS.switchLine} checked={shown.on} onChange={shown.setOn} />
        <p role="status" className="m-0 flex items-center gap-1.5 type-meta text-ink-2">
          <PlugZap aria-hidden className={cn('size-3.5 shrink-0', shown.on ? 'text-success-strong' : 'text-ink-3')} />
          {shown.on ? AGENT_WORDS.listening : AGENT_WORDS.off}
        </p>
      </section>
      {shown.on ? (
        <section className="flex flex-col gap-3">
          <ViewHeading icon={Link2} title="Connect an agent" line={AGENT_WORDS.connectLine} />
          <div className="flex flex-col gap-1.5">
            <p aria-hidden className="m-0 type-label text-ink">
              Which app?
            </p>
            <AppChoice value={shown.app} onChange={shown.setApp} />
          </div>
          <div className="flex flex-col gap-1.5">
            <p aria-hidden className="m-0 type-label text-ink">
              What it may do
            </p>
            <Segmented label="What it may do" options={LEVEL_OPTIONS} value={shown.level} onChange={shown.setLevel} />
            <p className="m-0 type-meta text-ink-2">{lineOf(shown.level)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              aria-busy={shown.connecting || undefined}
              onClick={shown.connect}
              className={buttonClasses('secondary', 'md')}
            >
              {shown.connecting ? 'Copying setup…' : 'Connect and copy setup'}
            </button>
            <p role="status" className="m-0 flex items-center gap-1.5 type-body text-ink">
              {shown.copied ? (
                <>
                  <CircleCheck aria-hidden className="size-4 shrink-0 text-success-strong" />
                  {appOf(shown.copied).paste}
                </>
              ) : null}
            </p>
          </div>
          <p className="m-0 type-meta text-ink-3">{AGENT_WORDS.key}</p>
        </section>
      ) : null}
      <section className="flex flex-col gap-2">
        <ViewHeading icon={PlugZap} title="Connected agents" />
        {shown.sessions.length === 0 ? (
          <p className="m-0 type-body text-ink-2">No agents yet.</p>
        ) : (
          <ul aria-label="Connected agents" className="m-0 flex list-none flex-col p-0">
            {shown.sessions.map((s) => (
              <SessionRow key={s.id} session={s} shown={shown} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
