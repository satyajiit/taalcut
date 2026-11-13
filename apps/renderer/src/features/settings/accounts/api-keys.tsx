// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: api-keys (UX4) · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md
 *   v0.6 + UX4 (_orch/ux4/specs/design-set.md "One row")
 * Accounts › Keys: one SettingRow per provider (its mark, its name, how its key did as a chip, Test / Add key /
 *   Remove key), and the write-only key form opening under its row with the kit's Collapse: the field and its two
 *   buttons on one line (the buttons sit on the field's own centre line), the hint under them.
 * states: default · hover/focus/active (the buttons') · disabled (Save key until the key looks whole) · loading
 *   (Save key and Test spin) · error (the field's red edge and the cause in its hint; a failed check's cause under
 *   the row) · success (Save key draws its tick and holds it, then the form closes; the chip says Saved, not
 *   tested) */
import { Trans, useLingui } from '@lingui/react/macro';
import type { AccountsState } from '@taalcut/core';
import {
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  PageSection,
  SUCCESS_HOLD_MS,
  VERB_ICONS,
} from '@taalcut/ui';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { DateTime } from '../../shared/time';
import { describeErrorCode } from '../model-messages';
import { providerName } from '../providers';
import { SettingRow, SettingRows } from '../rows';
import { SETTINGS_ICONS } from '../settings-icons';
import { ProviderMark } from './sign-ins';

type KeyRow = AccountsState['apiKeys'][number];

export interface ApiKeyActions {
  /** Resolves to a translated error sentence, or null when saved. */
  save(provider: string, key: string): Promise<string | null>;
  test(provider: string): Promise<void>;
  remove(provider: string): Promise<void>;
  pending: string | null;
}

/** How the saved key did; nothing before there is one (the row's Add key says so). */
export function KeyStatus({ row }: { row: KeyRow }) {
  if (!row.configured) return null;
  if (!row.lastCheck)
    return (
      <Chip tone="neutral" className="whitespace-normal">
        <Trans>Saved, not tested</Trans>
      </Chip>
    );
  const at = row.lastCheck.at;
  return row.lastCheck.ok ? (
    <Chip tone="success" className="whitespace-normal">
      <Trans>
        Works · checked <DateTime at={at} />
      </Trans>
    </Chip>
  ) : (
    <Chip tone="danger" className="whitespace-normal">
      <Trans>Didn’t work</Trans>
    </Chip>
  );
}

/** One provider. The key field is write-only: after saving it is cleared, and the key is never shown again. */
function KeyRowItem({
  row,
  actions,
  open,
  onOpenChange,
}: {
  row: KeyRow;
  actions: ApiKeyActions;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useLingui();
  const id = useId();
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // The parent hands a new callback each render; the hold's timer must not restart with every one.
  const close = useRef(onOpenChange);
  close.current = onOpenChange;
  const name = providerName(i18n, row.provider);
  const busy = actions.pending === row.provider;

  useEffect(() => {
    if (open) input.current?.focus();
    else {
      setKey('');
      setError(null);
    }
  }, [open]);

  // A saved key holds its tick for a moment, then the form closes.
  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => {
      setSaved(false);
      close.current(false);
    }, SUCCESS_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [saved]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    const failure = await actions.save(row.provider, key);
    // Drop the key from memory either way; on failure the person types it again.
    setKey('');
    setSaving(false);
    if (failure) setError(failure);
    else setSaved(true);
  }

  const label = name ?? row.provider;
  return (
    <li data-provider={row.provider} className="flex flex-col border-t border-rule-subtle first:border-t-0">
      <SettingRow
        as="div"
        className="border-t-0"
        icon={<ProviderMark provider={row.provider} />}
        title={<span translate={name ? undefined : 'no'}>{label}</span>}
        description={
          row.lastCheck && !row.lastCheck.ok ? (
            <span className="text-danger-strong">{describeErrorCode(i18n, row.lastCheck.errorCode)}</span>
          ) : undefined
        }
        status={<KeyStatus row={row} />}
        control={
          <span className="flex flex-wrap justify-end gap-2">
            {row.configured ? (
              <Button size="sm" loading={busy && !saving} onClick={() => void actions.test(row.provider)}>
                <Trans>Test</Trans>
              </Button>
            ) : null}
            <Button
              size="sm"
              variant={row.configured ? 'ghost' : 'secondary'}
              icon={row.configured ? VERB_ICONS.swap : VERB_ICONS.add}
              aria-expanded={open}
              aria-controls={`${id}-form`}
              onClick={() => onOpenChange(!open)}
            >
              {row.configured ? <Trans>Replace key</Trans> : <Trans>Add key</Trans>}
            </Button>
            {row.configured ? (
              <Button size="sm" variant="ghost" icon={VERB_ICONS.delete} onClick={() => setConfirm(true)}>
                <Trans>Remove key</Trans>
              </Button>
            ) : null}
          </span>
        }
      />
      <Collapse id={`${id}-form`} open={open}>
        {/* Mounted only while open: a write-only key leaves no field behind when the form closes. */}
        {open ? (
          <form
            onSubmit={(event) => void submit(event)}
            className="flex flex-col gap-1.5 px-3 pt-1 pb-3 ps-14"
          >
            <label htmlFor={`${id}-key`} className="type-label text-ink">
              <Trans>{label} API key</Trans>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                ref={input}
                id={`${id}-key`}
                type="password"
                autoComplete="off"
                spellCheck={false}
                required
                minLength={8}
                value={key}
                status={error ? 'error' : undefined}
                aria-describedby={`${id}-hint`}
                onChange={(event) => setKey(event.target.value)}
                placeholder={t`Paste the key`}
                className="min-w-0 flex-[1_1_16rem]"
              />
              <Button
                type="submit"
                variant="primary"
                loading={saving || (busy && !saved)}
                status={saved ? 'success' : undefined}
                disabled={!saved && key.trim().length < 8}
              >
                <Trans>Save key</Trans>
              </Button>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                <Trans>Cancel</Trans>
              </Button>
            </div>
            <p
              id={`${id}-hint`}
              className={error ? 'm-0 type-meta text-danger-strong' : 'm-0 type-meta text-ink-2'}
            >
              {error ?? <Trans>Kept in your Mac’s keychain. Taalcut never shows it again.</Trans>}
            </p>
          </form>
        ) : null}
      </Collapse>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <Trans>Remove the {label} key?</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans>
                Taalcut stops using {label} until you add a key again. The key is deleted from your keychain.
              </Trans>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">
                <Trans>Keep it</Trans>
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              icon={VERB_ICONS.delete}
              onClick={() => {
                setConfirm(false);
                void actions.remove(row.provider);
              }}
            >
              <Trans>Remove {label} key</Trans>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

export function ApiKeys({
  state,
  actions,
  openProvider,
  onOpenProviderChange,
}: {
  state: AccountsState;
  actions: ApiKeyActions;
  openProvider: string | null;
  onOpenProviderChange: (provider: string | null) => void;
}) {
  return (
    <PageSection
      icon={SETTINGS_ICONS.keys}
      title={<Trans>API keys</Trans>}
      description={
        <Trans>
          A key from a provider’s website lets Taalcut use its models, billed to you by that provider. Keys
          stay in your Mac’s keychain.
        </Trans>
      }
    >
      <SettingRows>
        {state.apiKeys.map((row) => (
          <KeyRowItem
            key={row.provider}
            row={row}
            actions={actions}
            open={openProvider === row.provider}
            onOpenChange={(open) => onOpenProviderChange(open ? row.provider : null)}
          />
        ))}
      </SettingRows>
    </PageSection>
  );
}
