// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The experiment sandbox (P2-T2): core's ExperimentSandbox, its job kind and its agent tools. */
export * from './errors';
export {
  createExperimentSandbox,
  FREE_SPACE_RESERVE,
  SANDBOX_EXEC,
  type ExecSandboxOptions,
  type ExperimentSandboxOptions,
  type JobSandboxOptions,
  type SandboxHardwareSessions,
} from './sandbox';
export { DEFAULT_EXPERIMENT_TTL_MS, sweepExperiments } from './experiments';
export { type SandboxPrograms } from './validate';
export { type FetcherBinaries } from './validate-programs';
export { defaultProfilesDir, PROFILE_FILES } from './profiles';
export {
  createSandboxJobs,
  sandboxLimitsSchema,
  sandboxRunJob,
  sandboxRunRequestSchema,
  sandboxRunResultSchema,
} from './job';
export {
  recipeParamsSchemas,
  recipeRequest,
  SANDBOX_RECIPES,
  sandboxRecipeSchema,
  type RecipeParams,
  type SandboxRecipe,
  type SandboxRecipeCall,
} from './recipes';
export {
  sandboxFilesInputSchema,
  sandboxFilesOutputSchema,
  sandboxRunInputSchema,
  sandboxToolModule,
  type SandboxToolDeps,
} from './tools';
