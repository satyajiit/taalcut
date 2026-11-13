// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Generated and bundled files entering the library (P3-B6, P3-B7, P3-V6): core's GeneratedAssetSink, and the
 * 30-day purge of what nothing refers to (a library.collect step).
 */
export { createGeneratedAssetSink, type GeneratedAssetSinkOptions } from './generated-sink';
export { MAX_GENERATED_BYTES } from './generated-file';
export { probeGeneratedMedia, type GeneratedMediaProbe } from './generated-media';
export { GENERATED_FOLDER, generatedPath } from './generated-paths';
export { GENERATED_RETENTION_MS, purgeGenerated, type GeneratedPurgeDeps } from './generated-purge';
