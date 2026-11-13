// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: more ways · Plugins and other agents, drawn · mode: Persuade · system: WEB2 Remix Vernacular
 * states: the run (more-kit): finished (Postiz and Instagram Edits on; Claude Code allowed to edit and Codex to read;
 *   exports and deletes still ask) · playing (each plugin's switch turns on in turn, then the agents arrive and their
 *   levels are chosen, about 2.5 s) · narrow tray (under 40 rem the plugins and the agents stack). Decorative
 *   (aria-hidden): the switches and levels are drawings of the app's, not controls.
 * Settings › Plugins and Settings › External agents as the app has them: the two plugins by name (Instagram's own
 *   icon beside Edits; Postiz has none, so its name in words), and the agents on this Mac by Claude's and Codex's own
 *   icons, each with what it may do. */

import { Plug, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { BrandIcon } from '#components/brand/brand-icon';
import { MORE_WAYS } from '#content/home';
import { ICON_STROKE } from '#lib/icons';
import { Choice, SwitchOn, Tray } from './more-kit';
import { rise } from './tour-motion';

const W = MORE_WAYS.rows.plugins;
const AGENT_ICONS = { 'Claude Code': 'claude', Codex: 'codex' } as const;
const AGENT = (i: number) => 1 + i * 0.35;

function Heading({ children }: { readonly children: string }) {
  return <span className="type-caption font-semibold text-ink-2">{children}</span>;
}

export function PluginsDrawing({ className }: { readonly className?: string }) {
  return (
    <Tray place={W.place} icon={<Plug strokeWidth={ICON_STROKE} />} className={className} bodyClassName="grid grid-cols-1 gap-5 p-4 @[40rem]:grid-cols-2 @[40rem]:gap-6 @[40rem]:p-5">
      <div className="flex min-w-0 flex-col gap-2">
        <Heading>{W.list}</Heading>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {W.plugins.map((p, i) => (
            <li key={p.name} className="flex min-w-0 items-center gap-3 rounded-xl bg-raised px-3 py-2.5 shadow-sm ring-1 ring-rule-subtle">
              <span className="inline-grid size-8 shrink-0 place-items-center rounded-lg bg-sunken text-ink-2">
                {p.name === 'Instagram Edits' ? <BrandIcon id="instagram" className="size-4.5" /> : <Plug strokeWidth={ICON_STROKE} className="size-4" />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate type-label-sm font-semibold text-ink">{p.name}</span>
                <span className="truncate type-caption text-ink-2">{p.does}</span>
              </span>
              <SwitchOn at={0.3 + i * 0.35} />
            </li>
          ))}
        </ul>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <Heading>{W.agents}</Heading>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {W.agentRows.map((a, i) => (
            <motion.li key={a.name} variants={rise(AGENT(i))} className="flex min-w-0 items-center gap-3 rounded-xl bg-raised px-3 py-2.5 shadow-sm ring-1 ring-rule-subtle">
              <span className="inline-grid size-8 shrink-0 place-items-center rounded-lg bg-sunken">
                <BrandIcon id={AGENT_ICONS[a.name]} className="size-4.5" />
              </span>
              <span className="min-w-0 flex-1 truncate type-label-sm font-semibold text-ink">{a.name}</span>
              <Choice options={W.levels} picked={W.levels.indexOf(a.level)} at={AGENT(i) + 0.3} />
            </motion.li>
          ))}
        </ul>
        <motion.span variants={rise(AGENT(2))} className="inline-flex items-center gap-1.5 ps-1 type-caption text-ink-2">
          <ShieldCheck strokeWidth={ICON_STROKE} className="size-3.5 text-teal-strong" />
          {W.ask}
        </motion.span>
      </div>
    </Tray>
  );
}
