// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Constants replaced at bundle time (packaging/build-settings.ts). Compare
 * them directly, e.g. `if (__TAALCUT_FLAVOUR__ === 'test')`, so the bundler
 * drops test-only code from release builds.
 */
declare const __TAALCUT_FLAVOUR__: 'release' | 'test';
/** The update feed baked into this build, or '' for none. The only feed address. */
declare const __TAALCUT_UPDATE_FEED__: string;
/** internal, alpha, beta, stable, or '' for the Phase 1 latest-mac.yml feed. */
declare const __TAALCUT_UPDATE_CHANNEL__: '' | 'internal' | 'alpha' | 'beta' | 'stable';
/** Crash ingest (Sentry or GlitchTip), or '' when this build cannot report. */
declare const __TAALCUT_CRASH_DSN__: string;
/** Telemetry ingest, or '' when nothing is queued or sent. */
declare const __TAALCUT_TELEMETRY_URL__: string;
/** The template hub's index document and Worker origin, or '' each when this build bakes none. */
declare const __TAALCUT_HUB_INDEX_URL__: string;
declare const __TAALCUT_HUB_WORKER_URL__: string;
/** Test builds only: a fault the update e2e bakes into a deliberately broken build ('' otherwise). */
declare const __TAALCUT_TEST_UPDATE_FAULT__: '' | 'exit-before-ready';
/**
 * Signature-free sha256 of the mac helper this app was packaged with (packaging/mac-helper.ts), or '' in a bundle
 * built without one. A packaged app runs only that helper; packaging fails rather than ship without a pin.
 */
declare const __TAALCUT_MAC_HELPER_PIN__: string;
