// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4 (S5: one walkthrough, each step said once)
 * Hallmark · component: onboarding, my phone over Wi-Fi · genre: atmospheric studio app · system: DESIGN.md v0.6
 * the Wi-Fi import screen itself (the computer listens only while it is open), on the column's own edge (UX3): the
 *   listening band, then the QR on its raised plate (it carries the session's pairing token, so the phone that
 *   scans it skips the setup code) with its three steps beside it (scan, Allow here, pick the clips), then the
 *   standing notes, first run's line for iPhones first. The first file landing turns Continue on; the way's tile
 *   says "Receiving from iPhone · 3 of 12" (shown once there, announced politely from here).
 * states: the Wi-Fi screen's own (starting, listening, connected, uploading, stopped, no Wi-Fi, error) · receiving
 *   (the row's line, announced)
 */
import { Trans } from '@lingui/react/macro';
import { UserContent } from '@taalcut/ui';
import { useEffect } from 'react';
import { ImportConnection } from '../../../features/library/imports/import-connect';
import { usePhoneFlow } from '../../../features/library/phone/session/phone-flow';

/** What the step needs from the Wi-Fi import: a file arriving starts the import. */
export interface WifiProgress {
  readonly device: string | null;
  readonly files: number;
  readonly done: number;
}

export function WifiSource({ onProgress }: { onProgress: (progress: WifiProgress) => void }) {
  const { transfer } = usePhoneFlow();
  const { session, files: received } = transfer;
  const device = session?.devices[0]?.label ?? null;
  const files = received.length;
  const done = received.filter((file) => file.state === 'imported' || file.state === 'duplicate').length;
  useEffect(() => {
    onProgress({ device, files, done });
  }, [device, files, done, onProgress]);
  return (
    <div className="flex flex-col">
      {files > 0 ? (
        // Shown once, on the way's row (sources-setup.tsx); here it is only announced.
        <p role="status" className="sr-only">
          {device ? (
            <Trans>
              Receiving from <UserContent translate="no">{device}</UserContent> · {done} of {files}
            </Trans>
          ) : (
            <Trans>
              Receiving · {done} of {files}
            </Trans>
          )}
        </p>
      ) : null}
      <ImportConnection method="phone-wifi" />
    </div>
  );
}
