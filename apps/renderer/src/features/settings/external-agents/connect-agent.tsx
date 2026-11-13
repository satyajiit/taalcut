// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: connect an agent · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * three answers and one button: a name, which app (Claude Code, Codex, another), what it may do (a segmented
 *   control, Look only first); "Connect and copy setup" asks main to mint the key and put the setup on the
 *   clipboard. The key never reaches this page: what shows is "Copied" and where to paste it.
 * states: default · hover/focus/active (fields, Segmented, Button) · disabled (while one is on its way; off, the page doesn’t show the form) ·
 *   loading (the button spins) · error (ErrorLine, the fields kept) · success (Copied and where to paste, announced)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import {
  callRpc,
  MCP_CLIENT_KINDS,
  MCP_LEVELS,
  type McpClientKind,
  type McpLevel,
  type TaalcutError,
} from '@taalcut/core';
import { Button, ErrorLine, Input, Segmented } from '@taalcut/ui';
import { CircleCheck } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { useBackend } from '../../../backend/backend';
import { CLIENT_FORMATS, CLIENT_WORDS, LEVEL_WORDS, PASTE_WORDS } from './agent-words';

export function ConnectAgent() {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const nameId = useId();
  const [name, setName] = useState('');
  const [client, setClient] = useState<McpClientKind>('claude-code');
  const [level, setLevel] = useState<McpLevel>('read');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TaalcutError | null>(null);
  const [copied, setCopied] = useState<McpClientKind | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const label = name.trim() || i18n._(CLIENT_WORDS[client]);
    setBusy(true);
    setError(null);
    setCopied(null);
    const made = await callRpc(
      backend.mcpSetup.createSession({ name: label, client, level, copy: CLIENT_FORMATS[client][0] }),
    );
    setBusy(false);
    if (!made.ok) return setError(made.error);
    setCopied(client);
    setName('');
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex max-w-2xl flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <p aria-hidden className="m-0 type-label text-ink">
          <Trans>Which app?</Trans>
        </p>
        <Segmented
          label={t`Which app?`}
          value={client}
          options={MCP_CLIENT_KINDS.map((kind) => ({ value: kind, label: i18n._(CLIENT_WORDS[kind]) }))}
          onChange={setClient}
          disabled={busy}
          className="self-start"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={nameId} className="type-label text-ink">
          <Trans>Name (optional)</Trans>
        </label>
        <Input
          id={nameId}
          value={name}
          maxLength={60}
          disabled={busy}
          placeholder={i18n._(CLIENT_WORDS[client])}
          onChange={(event) => setName(event.target.value)}
          className="max-w-sm"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <p aria-hidden className="m-0 type-label text-ink">
          <Trans>What it may do</Trans>
        </p>
        <Segmented
          label={t`What it may do`}
          value={level}
          options={MCP_LEVELS.map((each) => ({ value: each, label: i18n._(LEVEL_WORDS[each].name) }))}
          onChange={setLevel}
          disabled={busy}
          className="self-start"
        />
        <p className="m-0 type-body text-ink-2">{i18n._(LEVEL_WORDS[level].line)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" loading={busy}>
          <Trans>Connect and copy setup</Trans>
        </Button>
        <p role="status" className="m-0 flex items-center gap-1.5 type-body text-ink">
          {copied ? (
            <>
              <CircleCheck aria-hidden className="size-4 shrink-0 text-success-strong" />
              {i18n._(PASTE_WORDS[copied])}
            </>
          ) : null}
        </p>
      </div>
      <p className="m-0 type-meta text-ink-3">
        <Trans>
          The setup holds a key only this Mac knows. Taalcut keeps it in the keychain and never shows it here.
        </Trans>{' '}
        {/* Main clears the copy after SETUP_ON_CLIPBOARD_MS, two minutes (security review SB-33). */}
        <Trans>Taalcut clears it from the clipboard after two minutes, so paste it soon.</Trans>
      </p>
      {error ? <ErrorLine error={error} /> : null}
    </form>
  );
}
