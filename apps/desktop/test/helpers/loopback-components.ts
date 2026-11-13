// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A components release served from this machine (LNX1-CMP's host check): the objects hosting/build.mjs placed under
 * `<release>/objects/<id>/<version>/<file>`, on a loopback HTTP server (the manifest allows http on loopback), and
 * the manifest pointed at it instead of components.taalcut.app. The server is the development run's own
 * (src/utility/roots/dev-components.ts, TAALCUT_DEV_COMPONENTS).
 */
import { PUBLIC_BASE } from '../../src/utility/roots/dev-components';

export { PUBLIC_BASE, serveDirectory, type Loopback } from '../../src/utility/roots/dev-components';

/** Every components.taalcut.app url in `json` (a manifest) moved to `base`. */
export function pointedAt<T>(json: T, base: string): T {
  return JSON.parse(JSON.stringify(json).replaceAll(PUBLIC_BASE, base)) as T;
}
