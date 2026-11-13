// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: standing consents · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.6 + UX4 · SettingRows with SVGL ProviderLogo in a fixed slot · Revoke (Button, the registry's
 * revoke glyph): default · hover ·
 * focus · active · disabled (another revoke running) · loading (this one) · error (the cause under its
 * row) · success (the row goes; one plain line says what changed). */

import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import type { TaalcutError, UploadConsentInfo } from '@taalcut/core';
import { Button, PageSection, ProviderLogo, Skeleton, VERB_ICONS } from '@taalcut/ui';
import { useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useRpcAction, useRpcQuery } from '../../../backend/use-rpc';
import { useArrival } from '../../../shell/nav/use-arrival';
import { BoneRows } from '../bones';
import { LoadError, Notice } from '../fields';
import { describeError, translateKey } from '../model-messages';
import { providerName } from '../providers';
import { listOf } from './privacy-labels';
import { SettingRow, SettingRows } from '../rows';
import { SETTINGS_ICONS } from '../settings-icons';

const A_STEP = msg`A step`;

function ConsentRow({
  consent,
  label,
  busy,
  disabled,
  error,
  onRevoke,
}: {
  consent: UploadConsentInfo;
  label: string;
  busy: boolean;
  disabled: boolean;
  error: TaalcutError | undefined;
  onRevoke: () => void;
}) {
  const { t, i18n } = useLingui();
  // Company names, joined the way this language lists things.
  const providers = listOf(
    i18n,
    consent.providers.map((provider) => providerName(i18n, provider) ?? provider),
  );
  const since = i18n.date(new Date(consent.grantedAt), { dateStyle: 'medium' });
  return (
    <SettingRow
      data-module={consent.module}
      icon={
        <span className="flex w-15 shrink-0 items-center -space-x-1.5">
          {consent.providers.slice(0, 3).map((provider) => (
            <ProviderLogo key={provider} provider={provider} size="sm" />
          ))}
        </span>
      }
      title={label}
      description={
        <Trans>
          Sends files to <span translate="no">{providers}</span> without asking, since{' '}
          <time dateTime={new Date(consent.grantedAt).toISOString()} className="font-sans">
            {since}
          </time>
        </Trans>
      }
      control={
        <Button
          variant="secondary"
          size="sm"
          icon={VERB_ICONS.revoke}
          loading={busy}
          disabled={disabled}
          aria-label={t`Revoke “${label}”`}
          onClick={onRevoke}
        >
          <Trans>Revoke</Trans>
        </Button>
      }
    >
      {error ? (
        <Notice tone="danger" role="alert">
          {describeError(i18n, error)}
        </Notice>
      ) : null}
    </SettingRow>
  );
}

const CONSENT_BONES = [
  { title: '24%', lines: ['48%'], control: 'button', icon: true },
  { title: '30%', lines: ['56%'], control: 'button', icon: true },
] as const;

/**
 * The uploads you allowed once and for all ("Always allow" on a consent
 * card), each with Revoke. Revoking is immediate and can't be undone here
 * (only a consent card gives consent), so it says so in one plain line
 * instead of offering Undo.
 */
export function StandingConsents() {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  // Read on every arrival, not only on mount: nothing tells the page when a consent card's Always allow, or a
  // revoke elsewhere, changes the list, and Privacy picked again before another page arrived stays mounted.
  const arrival = useArrival();
  const consents = useRpcQuery((signal) => backend.consents.list(undefined, { signal }), [backend, arrival]);
  const revoke = useRpcAction((module: string) => backend.consents.revoke({ module }));
  const [revoking, setRevoking] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ module: string; error: TaalcutError } | null>(null);
  // Gone from the list at once; the next load agrees.
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [revoked, setRevoked] = useState<string | null>(null);

  const label = (module: string) => translateKey(i18n, `models.module.${module}.label`, A_STEP);

  const onRevoke = async (module: string) => {
    setRevoking(module);
    setFailure(null);
    const result = await revoke.run(module);
    setRevoking(null);
    if (!result.ok) {
      setFailure({ module, error: result.error });
      return;
    }
    setGone((before) => new Set([...before, module]));
    setRevoked(label(module));
    consents.reload();
  };

  const rows = (consents.data ?? []).filter((consent) => !gone.has(consent.module));
  return (
    <PageSection
      title={<Trans>Always allowed uploads</Trans>}
      icon={SETTINGS_ICONS.uploads}
      description={
        <Trans>
          When you choose “Always allow”, Taalcut sends that step’s files to the cloud without asking each
          time. Revoke it and the step asks again next time, even in a chat that is already running.
        </Trans>
      }
    >
      {revoked ? (
        <Notice tone="success" role="status">
          {t`“${revoked}” will ask again before sending files.`}
        </Notice>
      ) : null}
      {consents.status === 'loading' && !consents.data ? (
        <Skeleton name="settings-privacy-consents" loading fixture={<BoneRows rows={CONSENT_BONES} />}>
          {null}
        </Skeleton>
      ) : consents.status === 'error' && !consents.data ? (
        <LoadError
          error={consents.error}
          onRetry={consents.reload}
          what={<Trans>The uploads you allowed didn’t load.</Trans>}
        />
      ) : rows.length === 0 ? (
        <p className="m-0 max-w-prose type-body text-ink-2">
          <Trans>
            Nothing is sent without asking. When a step asks to send files and you choose “Always allow”, it
            is listed here so you can take it back.
          </Trans>
        </p>
      ) : (
        <SettingRows aria-label={t`Steps that send files without asking`}>
          {rows.map((consent) => (
            <ConsentRow
              key={consent.module}
              consent={consent}
              label={label(consent.module)}
              busy={revoking === consent.module}
              disabled={revoking !== null && revoking !== consent.module}
              error={failure?.module === consent.module ? failure.error : undefined}
              onRevoke={() => void onRevoke(consent.module)}
            />
          ))}
        </SettingRows>
      )}
    </PageSection>
  );
}
