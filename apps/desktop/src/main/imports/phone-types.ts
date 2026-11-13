// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { DeviceImportRunId, UtilityClient } from '@taalcut/core';
export type PhoneTransfer = UtilityClient<'lan'>['transfer'];
export interface PhoneImportOptions {
  readonly transfer: () => PhoneTransfer;
  readonly destinationLabel: string | (() => Promise<string>);
}
export interface PhoneImportCheckpoint {
  readonly deviceKey: string;
  readonly runId?: DeviceImportRunId;
}
