// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

export type { BranchPicture, DecodeRoute, DecodeRouteId } from './route';
export { surfaceRoute, type SurfaceRouteConfig } from './surface-route';
export { softwareRoute } from './software';
export {
  decodeProfileFor,
  decodeRouteFor,
  ENGINE_DECODERS,
  HARDWARE_DECODERS,
  type DecodeProfile,
  type DecodeProfileSource,
  type HardwareDecoder,
} from './select-route';
export {
  hardwareEncoderWontStart,
  hardwareRefused,
  hardwareWontStart,
  retryOnSoftware,
  retryOnSoftwareRoute,
  type RouteRetry,
  type SoftwareRetryOptions,
} from './software-retry';
