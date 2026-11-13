// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: a plugin's Tools and Skills views · mode: Operate · system: WEB2 Remix Vernacular
 * Tools: what the plugin can do (its features, rows of facts that don't wash, since they aren't controls), then the
 *   tools the AI can find with the access given, each with whether it only reads or acts outside Taalcut. Skills:
 *   the guides it brings, one row each with Read skill, which opens the guide's steps under the row in a well.
 * states: tools: listed (active) · none yet (why: connect and turn it on) · Read skill: default · hover · focus ·
 *   active · open (Hide skill, aria-expanded; the steps under it) */

import { BookOpen, ChevronDown, Puzzle, Wrench } from 'lucide-react';
import { cn } from '#lib/cn';
import { Chip } from '../chip';
import { ViewHeading } from './plugin-views';
import type { Plugins } from './use-plugins';

export function ToolsView({ shown }: { readonly shown: Plugins }) {
  const { plugin, state } = shown;
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3">
        <ViewHeading icon={Puzzle} title="Features" />
        <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 @min-[48rem]:grid-cols-2">
          {plugin.features.map((f) => (
            <li key={f.name} className="flex flex-col gap-0.5 rounded-lg bg-sunken px-3 py-2.5">
              <span className="type-label text-ink">{f.name}</span>
              <span className="type-meta text-ink-2">{f.description}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-3">
        <ViewHeading
          icon={Wrench}
          title="Tools"
          line="The AI can discover these tools. Your connection and access determine which it can run."
        />
        {state.enabled ? (
          <ul aria-label="Tools" className="m-0 list-none overflow-hidden rounded-lg border border-rule-subtle bg-raised p-0">
            {plugin.tools.map((tool) => (
              <li
                key={tool.name}
                className="flex flex-col gap-1.5 border-t border-rule-subtle px-3 py-2.5 first:border-t-0 @min-[40rem]:flex-row @min-[40rem]:items-start @min-[40rem]:justify-between @min-[40rem]:gap-4"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span translate="no" className="font-mono type-meta font-semibold break-words text-ink">
                    {tool.name}
                  </span>
                  <span className="type-meta text-ink-2">{tool.description}</span>
                </span>
                <Chip tone={tool.effect === 'Read' ? 'neutral' : 'warning'}>{tool.effect}</Chip>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 max-w-prose rounded-lg border border-dashed border-rule-strong px-3 py-2.5 type-body text-ink-2">
            Connect and activate this plugin to discover its tools.
          </p>
        )}
      </section>
    </div>
  );
}

export function SkillsView({ shown }: { readonly shown: Plugins }) {
  const { plugin, skill } = shown;
  return (
    <section className="flex flex-col gap-3">
      <ViewHeading
        icon={BookOpen}
        title="Skills"
        line="Skills guide the AI through this service. Reading a skill does not grant access to its tools."
      />
      <ul aria-label="Skills" className="m-0 list-none overflow-hidden rounded-lg border border-rule-subtle bg-raised p-0">
        {plugin.skills.map((s, i) => {
          const open = skill === s.name;
          const region = `${plugin.id}-skill-${i}`;
          return (
            <li key={s.name} className="flex flex-col gap-2 border-t border-rule-subtle px-3 py-2.5 first:border-t-0">
              <div className="flex flex-col gap-2 @min-[40rem]:flex-row @min-[40rem]:items-start @min-[40rem]:justify-between @min-[40rem]:gap-4">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="type-label text-ink">{s.name}</span>
                  <span className="type-meta text-ink-2">{s.description}</span>
                </span>
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={region}
                  onClick={() => shown.toggleSkill(s.name)}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 self-start rounded-pill border border-rule bg-control px-3 type-label-sm text-ink hover:bg-control-hover active:bg-control-pressed"
                >
                  <ChevronDown
                    aria-hidden
                    className={cn('size-3.5 transition-transform duration-(--dur-short) ease-(--ease-out) motion-reduce:transition-none', open && 'rotate-180')}
                  />
                  {open ? 'Hide skill' : 'Read skill'}
                </button>
              </div>
              <div id={region} hidden={!open}>
                <ol className="m-0 flex list-decimal flex-col gap-1 rounded-md bg-well py-2.5 ps-8 pe-3 type-body text-ink-2">
                  {s.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
