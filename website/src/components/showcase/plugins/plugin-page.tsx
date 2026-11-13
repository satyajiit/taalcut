// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: Settings › Plugins, the list and a plugin's page · mode: Operate · system: WEB2 Remix Vernacular
 * PluginList: Available plugins, one row each (its logo: Instagram's SVGL icon, Postiz in words beside a plain
 *   glyph, since SVGL has no Postiz; its name, what it does and who makes it; its status), the whole row opening it.
 *   PluginPage: who the plugin is (logo, what it does, status, publisher, version), its four views as tabs
 *   (Connection, Access, Tools, Skills) and the open view under them.
 * states: row: default · hover (washes) · focus (base ring) · active (pressed) · open (raised, an ink edge,
 *   aria-pressed) · status chip: Active (success) · Inactive · Not connected · the views' own (plugin-views,
 *   plugin-tools) · a view arriving rises 4 px and fades in (--dur-short); reduced motion: at once */

import { BookOpen, ChevronRight, Link2, Send, ShieldCheck, Wrench } from 'lucide-react';
import { motion } from 'motion/react';
import { useId } from 'react';
import { BrandIcon } from '#components/brand/brand-icon';
import { cn } from '#lib/cn';
import { DUR, EASE_OUT } from '#lib/motion';
import { Chip } from '../chip';
import { ViewTabs, viewTabId, type ViewTab } from './controls';
import { type PluginId, type PluginViewId, PLUGIN_VIEWS } from './plugins-data';
import { SkillsView, ToolsView } from './plugin-tools';
import { AccessView, ConnectionView } from './plugin-views';
import { type Plugins, statusOf, type PluginState } from './use-plugins';

const VIEW_ICONS: Readonly<Record<PluginViewId, typeof Link2>> = {
  connection: Link2,
  access: ShieldCheck,
  tools: Wrench,
  skills: BookOpen,
};
const TABS: readonly ViewTab<PluginViewId>[] = PLUGIN_VIEWS.map((v) => ({ ...v, icon: VIEW_ICONS[v.id] }));

/** A plugin's logo: Instagram's own icon; Postiz, which SVGL lacks, a plain glyph beside its name in words. */
export function PluginLogo({ id, large = false }: { readonly id: PluginId; readonly large?: boolean }) {
  const box = large ? 'size-14 rounded-xl' : 'size-10 rounded-lg';
  return (
    <span aria-hidden className={cn('inline-grid shrink-0 place-items-center border border-rule-subtle bg-raised shadow-xs', box)}>
      {id === 'instagram-edits' ? (
        <BrandIcon id="instagram" className={large ? 'size-7' : 'size-5'} />
      ) : (
        <Send className={cn('text-ink-2', large ? 'size-6' : 'size-4.5')} />
      )}
    </span>
  );
}

export function StatusChip({ state }: { readonly state: PluginState }) {
  const words = statusOf(state);
  return <Chip tone={words === 'Active' ? 'success' : 'neutral'}>{words}</Chip>;
}

export function PluginList({ shown, compact = false }: { readonly shown: Plugins; readonly compact?: boolean }) {
  return (
    <ul aria-label="Available plugins" className="m-0 flex list-none flex-col gap-1 p-0">
      {shown.plugins.map((p) => {
        const open = p.id === shown.open;
        return (
          <li key={p.id} data-plugin={p.id}>
            <button
              type="button"
              aria-pressed={open}
              onClick={() => shown.choose(p.id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg border p-2.5 text-start transition-colors duration-(--dur-micro) ease-(--ease-out) active:bg-pressed',
                open ? 'border-ink-3 bg-raised shadow-xs' : 'border-transparent hover:bg-hover',
              )}
            >
              <span data-slot="icon-text" className="contents">
                <PluginLogo id={p.id} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span translate="no" className="type-card-title text-ink">
                    {p.name}
                  </span>
                  {compact ? null : (
                    <span className="type-meta text-ink-2">
                      {p.summary} <span className="text-ink-3">· {p.publisher}</span>
                    </span>
                  )}
                </span>
              </span>
              <StatusChip state={shown.stateOf(p.id)} />
              <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-3" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function PluginPage({
  shown,
  views = PLUGIN_VIEWS.map((v) => v.id),
  compact = false,
}: {
  readonly shown: Plugins;
  readonly views?: readonly PluginViewId[];
  /** Settings kept secondary: who the plugin is in one line (the list beside it carries its logo and state). */
  readonly compact?: boolean;
}) {
  const panel = useId();
  const { plugin, state, view, reduce } = shown;
  const tabs = TABS.filter((t) => views.includes(t.id));
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {compact ? (
        <h4 translate="no" className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 type-card-title text-ink">
          {plugin.name}
          <span className="type-meta font-normal text-ink-3">
            {plugin.publisher} · Version {plugin.version}
          </span>
        </h4>
      ) : (
        <div className="flex items-start gap-4">
          <span data-slot="icon-text" className="contents">
            <PluginLogo id={plugin.id} large />
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <h4 translate="no" className="m-0 type-page-title text-ink">
                {plugin.name}
              </h4>
              <span className="max-w-prose type-body text-ink-2">{plugin.description}</span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <StatusChip state={state} />
                <span className="type-meta text-ink-3">{plugin.publisher}</span>
                <span className="type-meta text-ink-3">Version {plugin.version}</span>
              </span>
            </span>
          </span>
        </div>
      )}
      <ViewTabs label="Plugin" tabs={tabs} value={view} onChange={shown.setView} panel={panel} />
      <motion.div
        key={`${plugin.id}-${view}`}
        id={panel}
        role="tabpanel"
        aria-labelledby={viewTabId(panel, view)}
        data-view-panel={view}
        initial={shown.moved && !reduce ? { opacity: 0, y: 4 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduce ? 0.15 : DUR.short, ease: EASE_OUT }}
      >
        {view === 'connection' ? (
          <ConnectionView shown={shown} />
        ) : view === 'access' ? (
          <AccessView shown={shown} />
        ) : view === 'tools' ? (
          <ToolsView shown={shown} />
        ) : (
          <SkillsView shown={shown} />
        )}
      </motion.div>
    </div>
  );
}
