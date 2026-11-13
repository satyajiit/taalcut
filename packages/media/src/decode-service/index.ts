// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The decode service (IX2-V3): the port and the mac helper's implementation. Media's barrel re-exports these. */
export { createMacHelperDecodeService, DECODE_FRAMES_METHOD, DECODE_PASS_METHOD } from './mac-helper';
export {
  helperDecodeService,
  openDecodeService,
  type HelperDecodeServiceOptions,
  type OpenDecodeServiceOptions,
} from './helper-service';
export {
  DECODE_SERVICE_ENV,
  DECODE_SERVICE_SETTINGS,
  decodeServiceChoice,
  decodeServiceWarning,
  DEFAULT_DECODE_SERVICE,
  serviceFor,
  type DecodeServiceChoice,
  type DecodeServiceSetting,
} from './switch';
export type {
  DecodeFramesReport,
  DecodeFramesRequest,
  DecodeFramesSet,
  DecodePassOptions,
  DecodePassReport,
  DecodePassRequest,
  DecodePassSet,
  DecodeService,
  DecodeServiceTask,
} from './types';
