// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type TelemetryEnvelope, type TelemetryEvent } from '@taalcut/core';

export function eventsNamed<N extends TelemetryEvent['name']>(
  envelopes: readonly TelemetryEnvelope[],
  name: N,
): (TelemetryEnvelope & { event: Extract<TelemetryEvent, { name: N }> })[] {
  return envelopes.filter(
    (envelope): envelope is TelemetryEnvelope & { event: Extract<TelemetryEvent, { name: N }> } =>
      envelope.event.name === name,
  );
}
