// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * ONNX Runtime's macOS build carries Microsoft's 1DS telemetry
 * (`core/platform/posix/telemetry.cc`, measured in 1.30.0): a process that
 * creates an ORT environment posts to mobile.events.data.microsoft.com. The
 * indexing e2e's network watch caught the jobs process doing it ten seconds
 * into indexing. Taalcut sends nothing anywhere without the person's say, so
 * every process that may load ORT turns it off first: the library reads
 * `ORT_DISABLE_TELEMETRY` (only '0' and '1' are valid) when it starts its
 * telemetry, and Node's `process.env` writes reach the C `getenv`.
 */
export const ORT_TELEMETRY_ENV = 'ORT_DISABLE_TELEMETRY';

export function disableOrtTelemetry(env: Record<string, string | undefined> = process.env): void {
  env[ORT_TELEMETRY_ENV] = '1';
}
