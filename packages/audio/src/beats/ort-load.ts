// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Media loads `onnxruntime-node` from its own file, and it is not a media
 * dependency. Audio owns the package, so the import has to start here.
 */
import type { OnnxRuntimeOptions } from '@taalcut/media';

type LoadOnnx = NonNullable<OnnxRuntimeOptions['loadModule']>;

export const loadOnnxRuntime: LoadOnnx = async () =>
  (await import('onnxruntime-node')) as unknown as Awaited<ReturnType<LoadOnnx>>;
