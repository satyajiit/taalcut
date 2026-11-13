// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { AsyncLocalStorage } from 'node:async_hooks';

/** The device authenticated for the tus request currently being handled. */
export const requestDevice = new AsyncLocalStorage<{ deviceId: string }>();
