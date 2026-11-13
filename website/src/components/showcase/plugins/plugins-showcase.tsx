// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: Plugins and other agents, the showcase and its fragment · mode: Operate · system: WEB2 Remix Vernacular
 * two coded app windows, led by what a plugin does for a video: first the Vietnam cut at work, Claude Code's ask to
 *   export it (on the app's approval card, the reel's poster, the level you gave it) and its Postiz post (a 9:16
 *   preview playing, its channel, words and time) waiting for your approval (at-work.tsx); then, compact and
 *   secondary, the Settings behind them: Plugins (Postiz and Instagram Edits, the open one's Connection, Access,
 *   Tools and Skills) beside External agents (the switch, connect Claude Code or Codex, what each may do, Revoke).
 *   The fragment is the ask, working, and the two plugins' states.
 * states: each window's arrival (once, when scrolled to: Claude Code connects and its ask arrives, its level lighting
 *   up; Instagram Edits is connected and given access) · finished (the server's HTML and reduced motion) · Replay
 *   (quiet: default, hover, focus, active) · the parts' own (at-work, plugin-page, plugin-views, plugin-tools,
 *   external-agents) · the stickers pop once and lean */

import { Power, ShieldCheck } from 'lucide-react';
import { AppWindow } from '#components/ui/app-window';
import { buttonClasses } from '#components/ui/button-classes';
import { Sticker } from '#components/ui/sticker';
import { SHOWCASE_ICONS } from '../icons';
import { ShowcasePlate } from '../plate';
import { AskCard, EditsSound, PostCard } from './at-work';
import { ExternalAgents } from './external-agents';
import { PluginList, PluginPage, StatusChip } from './plugin-page';
import { useAgents } from './use-agents';
import { usePlugins } from './use-plugins';

function Replay({ onClick, what }: { readonly onClick: () => void; readonly what: string }) {
  const Glyph = SHOWCASE_ICONS.replay;
  return (
    <button type="button" onClick={onClick} aria-label={`Replay: ${what}`} className={buttonClasses('quiet', 'md', 'shrink-0')}>
      <Glyph aria-hidden className="size-4" />
      Replay
    </button>
  );
}

export function PluginsShowcase() {
  const plugins = usePlugins({ autoplay: true });
  const agents = useAgents({ autoplay: true });
  return (
    <div className="flex flex-col gap-14">
      <div className="relative">
        <AppWindow title="Vietnam, walking away on every beat" area="make" size="lg" fit="fluid">
          <ShowcasePlate slug="plugins" label="Plugins and other agents at work on a video" className="flex flex-col gap-5">
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-rule-subtle pb-4">
              <div className="flex min-w-0 flex-col gap-1">
                <h3 className="m-0 type-page-title text-ink">Your version, ready to go out</h3>
                <p className="m-0 max-w-prose type-body text-ink-2">An agent on this Mac asks to export it. Postiz holds its post. Both wait for you.</p>
              </div>
              <Replay onClick={agents.replay} what="Claude Code’s ask arrives" />
            </header>
            <div
              ref={agents.box}
              data-run={agents.running ? 'playing' : 'done'}
              className="grid grid-cols-1 gap-8 @min-[52rem]:grid-cols-[minmax(0,1fr)_17rem] @min-[52rem]:gap-10"
            >
              <div className="flex min-w-0 flex-col gap-4 @min-[52rem]:pt-2">
                <AskCard agents={agents} />
                <EditsSound />
                <p className="m-0 max-w-prose type-meta text-pretty text-ink-2">
                  Other agents work in Taalcut at the level you give them. Exports and deletes still come to you as a card like this one, and you can revoke an agent at any time.
                </p>
              </div>
              <PostCard />
            </div>
          </ShowcasePlate>
        </AppWindow>
        <span className="pointer-events-none absolute -top-5 right-4 max-sm:hidden [&>*]:pointer-events-auto">
          <Sticker field="sky" icon={ShieldCheck} tilt={4}>
            Exports still ask you
          </Sticker>
        </span>
      </div>
      <div className="relative mx-auto w-full max-w-5xl">
        <AppWindow title="Settings" area="settings" size="md" sidebar={false} fit="fluid">
          <ShowcasePlate slug="plugins-settings" label="Settings › Plugins and External agents" className="grid grid-cols-1 gap-8 @min-[56rem]:grid-cols-2 @min-[56rem]:gap-6">
            <section aria-label="Plugins" className="flex min-w-0 flex-col gap-4">
              <header className="flex items-center justify-between gap-3">
                <h3 className="m-0 type-section text-ink">Plugins</h3>
                <Replay onClick={plugins.replay} what="connect Instagram Edits" />
              </header>
              <div ref={plugins.box} data-run={plugins.running ? 'playing' : 'done'} className="flex min-w-0 flex-col gap-4">
                <PluginList shown={plugins} compact />
                <PluginPage shown={plugins} compact />
              </div>
            </section>
            <section aria-label="External agents" className="flex min-w-0 flex-col gap-4 border-t border-rule-subtle pt-6 @min-[56rem]:border-t-0 @min-[56rem]:border-s @min-[56rem]:ps-6 @min-[56rem]:pt-0">
              <h3 className="m-0 type-section text-ink">External agents</h3>
              <ExternalAgents shown={agents} />
            </section>
          </ShowcasePlate>
        </AppWindow>
        <span className="pointer-events-none absolute -top-5 -right-3 max-sm:hidden [&>*]:pointer-events-auto">
          <Sticker field="lime" icon={Power} tilt={-4}>
            Off until you turn it on
          </Sticker>
        </span>
      </div>
    </div>
  );
}

/** The features index's piece: Claude Code's ask, working, and the two plugins' states. */
export function PluginsFragment() {
  const agents = useAgents({ autoplay: false });
  const plugins = usePlugins({ autoplay: false });
  return (
    <AppWindow title="Vietnam, walking away on every beat" area="make" size="sm" sidebar={false} fit="fluid">
      <ShowcasePlate slug="plugins-fragment" label="An agent’s ask to export a video, and the plugins that are on" className="flex flex-col gap-4">
        <AskCard agents={agents} compact />
        <ul aria-label="Plugins" className="m-0 flex list-none flex-wrap gap-x-4 gap-y-2 p-0">
          {plugins.plugins.map((p) => (
            <li key={p.id} data-plugin={p.id} className="flex items-center gap-2 type-label text-ink">
              <span translate="no">{p.name}</span>
              <StatusChip state={plugins.stateOf(p.id)} />
            </li>
          ))}
        </ul>
      </ShowcasePlate>
    </AppWindow>
  );
}
