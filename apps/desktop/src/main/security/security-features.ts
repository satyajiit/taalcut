// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Chromium features a release build won't let `--disable-features` turn off (security review SB-7). Refusing
 * the switch outright would break support workarounds (turning off one buggy feature), so the flag guard
 * refuses it only when it names one of these: site and origin isolation, service sandboxes, private network
 * checks, response blocking, storage and connection partitioning, V8's write protection and Wasm trap handler.
 *
 * Names are Chromium's `base::Feature` names. Each one is in Electron 44.7.2's framework binary (read with
 * `strings`, 2026-10-15), except the older ones kept because people still pass them (`site-per-process`,
 * `NetworkServiceSandbox`, the private network names): a name Chromium no longer knows does nothing, and
 * refusing it costs nothing. Chromium matches names exactly; the guard ignores case, which only refuses more.
 *
 * `--enable-features` stays allowed: turning a feature on can't remove a protection the window policy
 * enforces (permissions denied, CSP, the sandbox), and the switches that loosen the web platform as a whole
 * (`--enable-blink-features`, `--enable-experimental-web-platform-features`) are refused in switches.ts.
 */
const SECURITY_FEATURES: ReadonlySet<string> = new Set(
  [
    // Site and origin isolation.
    'SitePerProcess',
    'site-per-process',
    'IsolateOrigins',
    'StrictOriginIsolation',
    'OriginKeyedProcessesByDefault',
    'IsolateSandboxedIframes',
    'SiteIsolationForCrossOriginOpenerPolicy',
    'EnforceIsolatedWorldOriginLock',
    'CheckSiteInstanceOnHistoryNavigation',
    // Service process sandboxes.
    'AudioServiceSandbox',
    'NetworkServiceSandbox',
    // Requests from a page to the Mac or the local network.
    'LocalNetworkAccessChecks',
    'BlockInsecurePrivateNetworkRequests',
    'PrivateNetworkAccessSendPreflights',
    'PrivateNetworkAccessRespectPreflightResults',
    // Cross-origin response blocking.
    'OpaqueResponseBlockingV01',
    'OpaqueResponseBlockingV02',
    'OpaqueResponseBlockingErrorsForAllFetches',
    // Partitioning of storage, caches and connections.
    'ThirdPartyStoragePartitioning',
    'PartitionConnectionsByNetworkIsolationKey',
    'SplitCacheByNetworkIsolationKey',
    'SplitCodeCacheByNetworkIsolationKey',
    'BlockCrossPartitionBlobUrlFetching',
    // V8 and WebAssembly memory protections.
    'V8CodeMemoryWriteProtection',
    'WebAssemblyTrapHandler',
  ].map((name) => name.toLowerCase()),
);

/**
 * The feature names in a `--enable-features` / `--disable-features` value: comma-separated, each optionally
 * `*`-prefixed (default state) and followed by `<Trial`, `.Group` or `:param/value` (field trial forms).
 */
export function featureNames(value: string): string[] {
  return value
    .split(',')
    .map((entry) => (/^\*?([^<:.]*)/.exec(entry.trim())?.[1] ?? '').trim())
    .filter((name) => name.length > 0);
}

/** The security features a `--disable-features` value names, as given. */
export function disabledSecurityFeatures(value: string): string[] {
  return featureNames(value).filter((name) => SECURITY_FEATURES.has(name.toLowerCase()));
}
