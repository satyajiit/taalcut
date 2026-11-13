// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

export { createProductService, type ProductOperations } from './service';
export { createProductCommands } from './commands';
export { productToolModule } from './tools';
export type { ProductServiceDeps, ProductResearchInput, ProductCreationInput } from './ports';
export { productFeatureKey, repeatedProductIdea, shortlistProductIdeas } from './novelty';
export * from './errors';
export { productCampaignFailure } from './retry';
export { productMemoryContext, fitProductMemory, type ProductMemoryContext } from './knowledge';
