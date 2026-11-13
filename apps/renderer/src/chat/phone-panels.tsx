// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: the source picker's phone panels · genre: atmospheric studio app · system: DESIGN.md v0.3
 * the card's two ways in, as the app already builds them: the Wi-Fi import page (the Mac listens while it is open)
 *   and first run's cable flow (find the phone, its own prompts in words, the picker, the run's block)
 * states: each panel's own (listening, receiving, stopped, no Wi-Fi; waiting for a phone, found, a prompt on the
 *   phone, ready, importing, error)
 */
import type { PhoneMethod } from '@taalcut/ui';
import { type ReactNode } from 'react';
import type { Backend } from '../backend/backend';
import { PhonePage } from '../features/library/phone/phone-page';
import { EmbeddedImport } from '../features/library/imports/embedded-import';
import { followStream } from './follow-stream';

/** The cable flow, keeping the run it starts so its block stays shown. */
function CablePanel() {
  return <EmbeddedImport method="phone-cable" onStarted={() => undefined} />;
}

/** CardData.phonePanel: what the source picker shows for each way in. */
export function phonePanel(method: PhoneMethod): ReactNode {
  return method === 'cable' ? <CablePanel /> : <PhonePage />;
}

/**
 * CardData.watchPhoneOnCable: whether transfer.devices lists a connected phone, then every change. When the
 * stream ends (the card went away, or main did) no phone is listed, so the cable stays second.
 */
export function watchPhoneOnCable(backend: Backend, onChange: (listed: boolean) => void): () => void {
  return followStream(
    (signal) => backend.transfer.devices(undefined, { signal }),
    (state) => onChange(state.devices.some((device) => device.connected)),
    () => onChange(false),
  );
}
