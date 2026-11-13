// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

export {
  helperCode,
  SidecarFailed,
  SidecarNotFound,
  SidecarPinMismatch,
  SidecarRejected,
  StillUnreadable,
} from './errors';
export {
  createJsonLineSidecar,
  type JsonLineEvent,
  type JsonLineEventSidecar,
  type JsonLineMessage,
  type JsonLineRequestOptions,
  type JsonLineSidecar,
  type JsonLineSidecarOptions,
  type JsonValue,
} from './json-line';
export {
  MAC_HELPER_ENV,
  createSidecarResolver,
  type ResolvedSidecar,
  type SidecarResolver,
  type SidecarResolverOptions,
  type SidecarSource,
} from './resolver';
export {
  createMacHelperStillReader,
  createProbeStillReader,
  stillFromProbe,
  type StillGps,
  type StillMetadata,
  type StillMetadataReader,
} from './still';
