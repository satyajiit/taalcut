// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Embeddings (P2-L9): the embedder, its Core ML and ONNX backends, the space, and an asset's vectors. Re-
 * exported whole by the package's entry point (src/index.ts).
 */
export { createEmbedder, type EmbedderOptions, type VisionEmbedder } from './embedder';
export type { NativeEmbeddingBackend } from './backend';
export { embedServeArgs, loadCoreMlModel, type CoreMlModelOptions } from './coreml-model';
export { developmentCoreMlLoader, type CoreMlFolders } from './coreml-development';
export { coreMlModelsDir, describeWrittenWeights, type WrittenCoreMlWeights } from './coreml-weights';
export {
  DEFAULT_EMBEDDING_PROFILE,
  embeddingProfile,
  macosMajor,
  type EmbeddingHardware,
  type EmbeddingProfile,
} from './profile';
export {
  EMBEDDING_DEVICES,
  loadTransformersModel,
  type EmbeddingDevice,
  type EmbeddingImage,
  type EmbeddingModel,
  type EmbeddingModelLoader,
  type EmbeddingModelOptions,
} from './model';
export {
  cosineDistance,
  DOCUMENT_PREFIX,
  EMBEDDING_COMPONENT,
  EMBEDDING_COREML_COMPONENT,
  EMBEDDING_COREML_MIN_MACOS,
  EMBEDDING_SPACE,
  embeddingFrameSize,
  IMAGE_TOKEN_BUDGETS,
  parseImageTokenBudget,
  imageTokens,
  meanDistance,
  prefixed,
  PROCESSOR_IMAGE_TOKENS,
  QUERY_PREFIX,
  unitVector,
  type ImageTokenBudget,
} from './space';
export { replaceAssetItems, type TextItem } from './asset-items';
export {
  checkSpace,
  embedAsset,
  frameItemId,
  type EmbedAssetContext,
  type EmbedAssetDeps,
  type EmbedAssetInput,
  type EmbedAssetOutput,
} from './embed-asset';
