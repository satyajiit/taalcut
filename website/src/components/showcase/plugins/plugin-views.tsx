// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: a plugin's Connection and Access views · mode: Operate · system: WEB2 Remix Vernacular (teal is your
 *   choice; marigold stays off this page: the agents' window holds the screen's one action)
 * Connection: where it connects (its address, read-only here), then its credential (what it is and where to copy
 *   it, Import from clipboard, then Credential saved and Replace from clipboard), Test connection and Connection
 *   verified, and the line that credentials are write-only. Access: what the AI may do, one checkbox row per kind of
 *   access, then the switch that lets the AI use the plugin at all.
 * states: import and test: default · hover · focus · active · working (its words, aria-busy) · done (the chip) ·
 *   disabled (Test before a credential, said why) · access rows and the switch: controls.tsx */

import { ClipboardPaste, KeyRound, Link2, RefreshCw, ShieldCheck } from 'lucide-react';
import { useId } from 'react';
import { buttonClasses } from '#components/ui/button-classes';
import { Chip } from '../chip';
import { CheckRow, SwitchRow } from './controls';
import type { Plugins } from './use-plugins';

/** A view's section heading: its glyph, its title and one line under it. */
export function ViewHeading({
  icon: Glyph,
  title,
  line,
}: {
  readonly icon: typeof Link2;
  readonly title: string;
  readonly line?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <h5 className="m-0 flex items-center gap-2 type-section text-ink">
        <Glyph aria-hidden className="size-4 shrink-0 text-ink-2" />
        {title}
      </h5>
      {line ? <p className="m-0 max-w-prose type-meta text-ink-2">{line}</p> : null}
    </div>
  );
}

export function ConnectionView({ shown }: { readonly shown: Plugins }) {
  const { plugin, state, work } = shown;
  const field = useId();
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3">
        <ViewHeading icon={Link2} title="Connection" line={plugin.address.hint} />
        <div className="flex max-w-xl flex-col gap-1.5">
          <label htmlFor={field} className="type-label text-ink">
            {plugin.address.name}
          </label>
          <input
            id={field}
            readOnly
            value={plugin.address.value}
            spellCheck={false}
            translate="no"
            className="h-9 w-full rounded-lg border border-rule-strong bg-sunken px-3 font-mono type-meta text-ink-2"
          />
        </div>
      </section>
      <section className="flex flex-col gap-3">
        <ViewHeading
          icon={KeyRound}
          title="Credentials"
          line="Copy the credential, then import it. It is stored securely on this Mac and never shown to the AI."
        />
        <div className="flex flex-col gap-3 rounded-lg border border-rule-subtle bg-raised p-3.5 @min-[44rem]:flex-row @min-[44rem]:items-start @min-[44rem]:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="m-0 flex flex-wrap items-center gap-2 type-label text-ink">
              {plugin.credential.name}
              {state.saved ? <Chip tone="success">Credential saved</Chip> : null}
            </p>
            <p className="m-0 max-w-prose type-meta text-ink-2">{plugin.credential.description}</p>
          </div>
          <button
            type="button"
            aria-busy={work === 'import' || undefined}
            disabled={work !== null}
            onClick={shown.importKey}
            className={buttonClasses('secondary', 'md', 'shrink-0 self-start')}
          >
            <ClipboardPaste aria-hidden className="size-4" />
            {work === 'import' ? 'Importing…' : state.saved ? 'Replace from clipboard' : 'Import from clipboard'}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            aria-busy={work === 'test' || undefined}
            disabled={work !== null || !state.saved}
            onClick={shown.test}
            className={buttonClasses('secondary', 'md')}
          >
            <RefreshCw aria-hidden className="size-4" />
            {work === 'test' ? 'Testing…' : 'Test connection'}
          </button>
          <span role="status" className="flex items-center gap-2 type-meta text-ink-2">
            {state.tested ? <Chip tone="success">Connection verified</Chip> : state.saved ? null : 'Import the credential first.'}
          </span>
        </div>
        <p className="m-0 flex items-center gap-1.5 type-meta text-ink-3">
          <ShieldCheck aria-hidden className="size-3.5 shrink-0" />
          Credentials are write-only.
        </p>
      </section>
    </div>
  );
}

export function AccessView({ shown }: { readonly shown: Plugins }) {
  const { plugin, state } = shown;
  return (
    <section className="flex flex-col gap-3">
      <ViewHeading
        icon={ShieldCheck}
        title="Access for the AI"
        line="Choose what this plugin may do. Changes apply immediately. Turning it off keeps the saved connection for later."
      />
      <ul aria-label="What the AI may do" className="m-0 list-none overflow-hidden rounded-lg border border-rule-subtle bg-raised p-0">
        {plugin.access.map((access) => (
          <CheckRow
            key={access.id}
            label={access.name}
            description={access.description}
            checked={state.granted.has(access.id)}
            onChange={(on) => shown.grant(access.id, on)}
          />
        ))}
      </ul>
      <SwitchRow
        label="Let the AI use this plugin"
        description={
          state.saved
            ? 'Its tools and skills become available within the access you selected.'
            : 'Import the required credentials before activating this plugin.'
        }
        checked={state.enabled}
        disabled={!state.saved}
        onChange={shown.setEnabled}
      />
    </section>
  );
}
