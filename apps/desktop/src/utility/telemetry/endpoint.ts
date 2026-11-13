// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The baked ingest URL. An empty build constant means this build queues and
 * sends nothing. http is accepted only for loopback, so a cleartext URL
 * cannot be aimed at the network; tests use http://127.0.0.1.
 */

/** A URL the transport may POST to, or undefined when telemetry must stay on the Mac. */
export function usableTelemetryEndpoint(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.username !== '' || url.password !== '') return undefined;
    const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1';
    if (url.protocol === 'https:') return value;
    if (url.protocol === 'http:' && loopback) return value;
    return undefined;
  } catch {
    return undefined;
  }
}

/** The URL baked into this build (or TAALCUT_TEST_TELEMETRY_URL in a test build), or undefined when empty. */
export function telemetryEndpoint(): string | undefined {
  return usableTelemetryEndpoint(
    __TAALCUT_TELEMETRY_URL__ || (__TAALCUT_FLAVOUR__ === 'test' ? process.env.TAALCUT_TEST_TELEMETRY_URL : ''),
  );
}

/** An explicit endpoint wins, including '' (off). Omitted means the baked URL. */
export function resolveTelemetryEndpoint(explicit: string | undefined): string | undefined {
  return explicit === undefined ? telemetryEndpoint() : usableTelemetryEndpoint(explicit);
}
