// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · DESIGN.md: dedicated Wi-Fi and USB cable routes fit the desktop viewport.
 * Embedded flows keep their existing layout; all connection methods retain explicit start actions. */

import { ImportError } from './import-error';
import { Trans, useLingui } from '@lingui/react/macro';
import { IMPORT_COMMANDS, type ImportDraftId, type ImportMethod, type ImportSource } from '@taalcut/core';
import { Button, Checkbox, usePlatformFeatures } from '@taalcut/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useRpcQuery } from '../../../backend/use-rpc';
import { Page } from '../../../shell/page';
import { usePhoneFlow } from '../phone/session/phone-flow';
import { CableWorkspace } from '../phone/connect/cable-workspace';
import { WifiWay } from '../phone/connect/wifi-way';
import { StatusBand } from '../phone/status/status-band';
import { METHOD_NAMES, METHOD_NOTES } from './import-words';
import { useImportCommand } from './use-import-command';
import { WifiWorkspace } from '../phone/connect/wifi-workspace';

export function ImportConnection({
  method,
  onCreated,
  compactWifi = false,
  compactCable = false,
}: {
  method: ImportMethod;
  onCreated?: (draftId: ImportDraftId, review: boolean) => void;
  compactWifi?: boolean;
  compactCable?: boolean;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const action = useImportCommand();
  const backend = useBackend();
  const sources = useRpcQuery<ImportSource[]>(
    (signal) =>
      compactCable && method === 'phone-cable'
        ? Promise.resolve([])
        : backend.imports.sources({ method }, { signal }),
    [backend, method, compactCable],
  );
  const phone = usePhoneFlow();
  const [watch, setWatch] = useState(false);
  const cableAvailable = usePlatformFeatures().cableImport;
  const connect = async (deviceId?: string) => {
    const result = await action.run<{ draftId: ImportDraftId | null }>(IMPORT_COMMANDS.createDraft, {
      method,
      watch,
      ...(deviceId ? { deviceId } : {}),
    });
    if (!result?.draftId) return;
    const review = method === 'files' || (method === 'folder' && watch);
    if (onCreated) return onCreated(result.draftId, review);
    await navigate({
      to:
        method === 'files' || (method === 'folder' && watch)
          ? '/library/import/$method/$draftId/review'
          : '/library/import/$method/$draftId/choose',
      params: { method, draftId: result.draftId },
    });
  };
  if (method === 'phone-wifi' && compactWifi)
    return <WifiWorkspace transfer={phone.transfer} onConnect={phone.connect} />;
  if (method === 'phone-cable' && compactCable)
    return (
      <CableWorkspace
        pending={action.pending}
        error={action.error}
        onConnect={(deviceId) => void connect(deviceId)}
      />
    );
  return (
    <>
      {method === 'phone-wifi' ? (
        <>
          {phone.transfer.enabled ? (
            <>
              <StatusBand transfer={phone.transfer} />
              <WifiWay
                transfer={phone.transfer}
                transfersLink={(children) => (
                  <Link to="/library/imports" search={{ phones: true }}>
                    {children}
                  </Link>
                )}
                helpLink={(children) => (
                  <Link to="/library/import/$method/help" params={{ method }}>
                    {children}
                  </Link>
                )}
              />
            </>
          ) : (
            <div className="flex flex-col items-start gap-4">
              <p className="m-0 max-w-prose type-body text-ink-2">
                <Trans>
                  Connect to show a private code or return to ongoing reception. Reception keeps running when
                  you leave this page, until you stop it or close Taalcut.
                </Trans>
              </p>
              <Button
                data-action="wifi-connect"
                variant="primary"
                onClick={phone.connect}
              >{t`Connect`}</Button>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-start gap-5">
          {method === 'folder' ? (
            <label className="flex items-start gap-3 type-body">
              <Checkbox checked={watch} onCheckedChange={(value) => setWatch(value === true)} />
              <span>
                <Trans>Watch this folder for new footage</Trans>
                <span className="mt-1 block max-w-prose type-meta text-ink-2">
                  <Trans>
                    Watched folders keep footage in place. You can review the initial scan and change its
                    scope.
                  </Trans>
                </span>
              </span>
            </label>
          ) : null}
          {method === 'photos' ? (
            <p className="m-0 max-w-prose type-body text-ink-2">
              <Trans>
                Connect to allow read access. Originals stay in Photos. iCloud downloads are off until you
                explicitly select a batch and allow them.
              </Trans>
            </p>
          ) : null}
          {method === 'insta360' ? (
            <p className="m-0 max-w-prose type-body text-ink-2">
              <Trans>
                Keep all original lens files and segments together. 360 originals are saved as captures;
                native stitching and reframing are not included.
              </Trans>
            </p>
          ) : null}
          {['camera', 'dji', 'insta360'].includes(method) ? (
            <p className="m-0 max-w-prose type-body text-ink-2">
              <Trans>
                Connect a card reader or select USB storage on the camera, then choose its mounted volume.
                Taalcut never deletes originals.
              </Trans>
            </p>
          ) : null}
          {method !== 'files' &&
            method !== 'folder' &&
            sources.data
              ?.filter((source) => source.available)
              .map((source) => (
                <Button
                  key={source.id}
                  variant="secondary"
                  disabled={action.pending}
                  onClick={() => void connect(source.id)}
                >
                  <span translate="no">{source.label}</span>
                </Button>
              ))}
          {sources.error ? <ImportError error={sources.error} onRetry={sources.reload} /> : null}
          {method === 'phone-cable' && !cableAvailable ? (
            <p className="m-0 type-body">
              <Trans>Cable import is unavailable on this computer. Use phone Wi-Fi instead.</Trans>{' '}
              <Link
                to="/library/import/$method"
                params={{ method: 'phone-wifi' }}
                className="underline underline-offset-4"
              >{t`Connect over Wi-Fi`}</Link>
            </p>
          ) : (
            <Button
              data-action="import-connect"
              variant="primary"
              loading={action.pending}
              onClick={() => void connect()}
            >
              {method === 'files' ? t`Choose files…` : method === 'folder' ? t`Choose folder…` : t`Connect`}
            </Button>
          )}
          {action.error ? <ImportError error={action.error} onRetry={() => void connect()} /> : null}
        </div>
      )}
      <div>
        {method === 'phone-wifi' ? (
          <Button asChild variant="secondary">
            <Link to="/library/imports" search={{ phones: true }}>{t`Follow reception`}</Link>
          </Button>
        ) : null}
        <Button asChild variant="ghost">
          <Link to="/library/import/$method/help" params={{ method }}>{t`Connection help`}</Link>
        </Button>
      </div>
    </>
  );
}

export function ImportConnect({ method }: { method: ImportMethod }) {
  const { t, i18n } = useLingui();
  if (method === 'phone-wifi' || method === 'phone-cable')
    return (
      <Page
        title={t`Import`}
        detail={i18n._(METHOD_NAMES[method])}
        width="wide"
        className="h-[calc(100dvh-var(--spacing-toolbar))] min-h-0 gap-4 py-4"
      >
        <ImportConnection
          method={method}
          compactWifi={method === 'phone-wifi'}
          compactCable={method === 'phone-cable'}
        />
      </Page>
    );
  return (
    <Page title={t`Import`} detail={i18n._(METHOD_NAMES[method])} description={i18n._(METHOD_NOTES[method])}>
      <ImportConnection method={method} />
    </Page>
  );
}
