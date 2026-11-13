// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Static import of @sentry/electron/main so the main bundle inlines the SDK.
 * The packaged app has no node_modules. sentry-main loads this file only when
 * process.versions.electron is set. Tests must not import it.
 */
export { captureEvent, flush, init, makeElectronOfflineTransport } from '@sentry/electron/main';
