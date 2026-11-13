// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

export {
  HW_VIDEO_BACKEND_IDS,
  MEDIA_BACKENDS,
  type EncodeFlagInput,
  type EncodePurpose,
  type HdrTransfer,
  type HwDecode,
  type HwEncode,
  type HwVideoBackend,
  type MachineVideoBackends,
} from './types';
export {
  backendOfEncoder,
  engineHardwareBackends,
  hardwareEncoderFor,
  HW_VIDEO_BACKENDS,
  hwVideoBackend,
  machineHardwareBackends,
  PLATFORM_HW_VIDEO,
  type HwBackendUse,
  type PlatformHwBackend,
} from './table';
export {
  DROP_DISPLAY_MATRIX,
  encoderTakesDeviceFrames,
  hwDecodeArgs,
  hwDecoder,
  hwDownloadFilters,
  hwScaleFilter,
  hwUprightFilters,
  keepsColourOnDevice,
  turnsOnDevice,
  TURN_DIRECTION,
  type Rotation,
} from './filters';
export {
  knownVideoBackends,
  machineVideoBackends,
  proveVideoBackends,
  VideoBackendSelection,
  type NamedMachine,
  type NamedVideoBackends,
} from './machine';
export { colourBitstreamFilter, hdrColour, SDR_COLOR, type TaggedCodec } from './colour';
export { cudaSurfaceFormat, vaapiSurfaceFormat, videoToolboxSurfaceFormat } from './surface';
export { nvencFlags } from './rows/cuda';
