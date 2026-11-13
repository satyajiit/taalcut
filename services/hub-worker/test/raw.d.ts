// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

declare module '*.sql?raw' {
  const source: string;
  export default source;
}

/** The Workers project's bindings: wrangler.jsonc plus the placeholder secrets in vitest.config.ts. */
declare module 'cloudflare:test' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- an ambient module can't import a relative path; import() is the only way to name HubEnv here
  export const env: import('../src/store/d1').HubEnv;
}
