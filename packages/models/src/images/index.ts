// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Image generation (P3-B7): API-key paths in route order, the price table and the images tool. */
export {
  IMAGE_ASPECTS,
  IMAGE_MEDIA_TYPES,
  IMAGE_SIZES,
  MAX_IMAGE_PROMPT,
  MAX_IMAGES_PER_REQUEST,
  type GeneratedImage,
  type ImageAccess,
  type ImageAspect,
  type ImageCharge,
  type ImageEstimate,
  type ImageFallback,
  type ImageMediaType,
  type ImageProvider,
  type ImageRequest,
  type ImageSize,
  type ImageTrace,
} from './image-types';
export { imageC2paReader } from './c2pa-reader';
export {
  createImageProviders,
  IMAGE_ROUTES,
  NEVER_ROUTED_IMAGE_MODELS,
  type ImageProvidersDeps,
} from './routes';
export {
  createImageProvider,
  promptText,
  type ImageC2paReader,
  type ImageModelRef,
  type ImageProviderDeps,
  type ImageRouteSpec,
  type ImageWireRequest,
  type ParsedImages,
} from './image-provider';
export {
  chainEstimate,
  generateImages,
  imageCandidates,
  imagePathAvailable,
  type ImageCandidate,
  type ImageChainDeps,
  type ImageGeneration,
  type ImagePath,
} from './image-chain';
export { fitsAspect, imageFacts, MIN_IMAGE_SIDE, type ImageFacts } from './image-bytes';
export { IMAGE_PRICES, IMAGE_PRICES_VERSION, imageEstimate, imagePrice, type ImagePriceRow } from './prices';
export { aspectOf, slotPlace, type SlotItem, type SlotPlace } from './image-slot';
export {
  createGenerateForSlotTool,
  createImageToolModule,
  GENERATE_FOR_SLOT_TIMEOUT_MS,
  imageToolModule,
  type ImageToolDeps,
  type ThumbnailStoredStillInput,
} from './image-tools';
export {
  buildHallmarkThumbnailPrompt,
  evaluateHallmarkThumbnail,
  HALLMARK_THUMBNAIL_AVOID,
  sanitizeDurationBadge,
  sanitizeHallmarkHook,
  sanitizeHallmarkKicker,
  sanitizeHallmarkStatBadge,
  THUMBNAIL_ASPECT_SPECS,
  type HallmarkEvalInput,
  type HallmarkPromptInput,
  type HallmarkThumbnailEvaluation,
  type ThumbnailAspectSpec,
} from './thumbnail-hallmark';
export {
  buildSocialMetadataPack,
  formatYoutubeTagsCsv,
  normalizeHashtags,
  normalizeSocialChapters,
  type SocialMetadataInput,
  type SocialMetadataPartial,
} from './social-metadata';
export { buildShortSocialMetadataPack, type ShortSocialMetadataInput } from './short-social-metadata';
export { buildProductSocialMetadata, type ProductSocialMetadataInput } from './product-social-metadata';
export {
  createGenerateThumbnailTool,
  generateThumbnailChannelInput,
  generateThumbnailInput,
  generateThumbnailKey,
  generateThumbnailOutput,
  generateThumbnailSocialInput,
  ImageGenerationOff,
  type GenerateThumbnailInput,
  type GenerateThumbnailOutput,
} from './thumbnail-tool';
export {
  buildComfyUiImageWorkflow,
  COMFYUI_DEFAULT_BASE_URL,
  COMFYUI_IMAGE_MODELS,
  COMFYUI_PROVIDER,
  createComfyUiImageProvider,
  type ComfyUiImageProviderDeps,
} from './providers/comfyui';
