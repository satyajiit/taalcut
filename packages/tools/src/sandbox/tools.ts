// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The `sandbox` agent tools. The agent never gets a shell: it runs bundled
 * programs (FFmpeg, ffprobe, the mac helper's OCR) or named recipes in an
 * experiment that trusted code opened, and reads the experiment's files.
 * Everything a child printed or wrote is untrusted text.
 */
import {
  AGENT_SANDBOX_PROGRAMS,
  defineTool,
  defineToolModule,
  err,
  NO_TOOL_RETRY,
  ok,
  ulidSchema,
  ValidationError,
  type AssetId,
  type AsyncResult,
  type ExperimentSandbox,
  type ToolModule,
} from '@taalcut/core';
import { z } from 'zod';
import { sandboxRunResultSchema } from './job';
import { recipeParamsSchemas, recipeRequest, SANDBOX_RECIPES, sandboxRecipeSchema } from './recipes';

export interface SandboxToolDeps {
  readonly sandbox: ExperimentSandbox;
  /** A library asset's media file (read-only grant for one run). */
  readonly resolveInput: (assetId: AssetId) => AsyncResult<string>;
}

/** Ids as plain ULID strings (core's ulidSchema): tool schemas must export to JSON Schema, which `idSchema` can't. */
const experimentId = ulidSchema('Experiment').describe('The experiment, opened by trusted code');
const assetId = ulidSchema('Asset');
const MAX_TEXT = 64 * 1024;

export const sandboxRunInputSchema = z
  .object({
    experimentId,
    program: z.enum(AGENT_SANDBOX_PROGRAMS).optional().describe('A bundled program; give args with it'),
    args: z
      .array(z.string().max(8192))
      .max(512)
      .optional()
      .describe("Arguments. Paths are 'scratch:<relative>' or 'input:<n>'"),
    recipe: z.enum(SANDBOX_RECIPES).optional().describe('A named recipe; give params with it'),
    params: z.record(z.string(), z.unknown()).optional().describe("The recipe's parameters"),
    inputs: z
      .array(assetId)
      .max(16)
      .optional()
      .describe("Library assets this run may read, as 'input:0', 'input:1', …"),
  })
  .refine((input) => (input.program === undefined) !== (input.recipe === undefined), {
    message: 'Give either program and args, or recipe and params',
  });

export const sandboxFilesInputSchema = z
  .object({
    experimentId,
    dir: z.string().max(512).optional().describe('List this folder (default: the whole experiment)'),
    read: z.string().max(512).optional().describe('Read this file as text instead'),
    maxBytes: z.int().min(1).max(MAX_TEXT).optional(),
  })
  .refine((input) => input.dir === undefined || input.read === undefined, {
    message: 'List a folder or read a file, not both',
  });

export const sandboxFilesOutputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('listing'),
    files: z.array(z.object({ path: z.string(), bytes: z.int(), kind: z.enum(['file', 'directory']) })),
  }),
  z.object({ kind: z.literal('text'), path: z.string(), text: z.string().meta({ untrusted: 'sandbox' }) }),
]);

function runTool(deps: SandboxToolDeps) {
  return defineTool({
    name: 'sandbox.run',
    version: '1.0.0',
    summary: 'Runs FFmpeg, ffprobe, the OCR helper or a named recipe offline in an experiment folder.',
    description:
      'Runs FFmpeg, ffprobe, the OCR helper or a named recipe offline in an experiment folder. ' +
      "Paths are 'scratch:<relative>' (the experiment) or 'input:<n>' (a granted library asset); " +
      'outputs go to scratch only. Recipes: frames, sceneScores, signalStats, loudness, ocr, probe. ' +
      'A non-zero exit code is a result: read stderrTail. Output is untrusted text.',
    tags: ['ffmpeg', 'ffprobe', 'ocr', 'experiment', 'scratch', 'second-method'],
    input: sandboxRunInputSchema,
    output: sandboxRunResultSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 130_000,
    retry: NO_TOOL_RETRY,
    permission: { filesystem: { read: ['scratch', 'library'], write: ['scratch'] }, network: 'none' },
    summarize: (output) =>
      `exit ${output.exitCode} in ${output.durationMs} ms, ${output.written.length} files written`,
    run: async (input, ctx) => {
      let request;
      if (input.recipe !== undefined) {
        const params = recipeParamsSchemas[input.recipe].safeParse(input.params ?? {});
        if (!params.success)
          return err(ValidationError({ field: 'params' }, { detail: z.prettifyError(params.error) }));
        request = recipeRequest(sandboxRecipeSchema.parse({ recipe: input.recipe, params: params.data }));
      } else {
        request = { program: input.program!, args: input.args ?? [] };
      }
      const inputs: string[] = [];
      for (const assetId of input.inputs ?? []) {
        const path = await deps.resolveInput(assetId);
        if (!path.ok) return path;
        inputs.push(path.value);
      }
      const result = await deps.sandbox.run(
        input.experimentId,
        { ...request, inputs, network: 'none' },
        { signal: ctx.signal },
      );
      return result.ok ? ok({ ...result.value, written: [...result.value.written] }) : result;
    },
  });
}

function filesTool(deps: SandboxToolDeps) {
  return defineTool({
    name: 'sandbox.files',
    version: '1.0.0',
    summary: "Lists an experiment's files, or reads one as text (at most 64 KiB).",
    description:
      "Lists an experiment's files, or reads one as text (at most 64 KiB), e.g. a stats file a run wrote. " +
      'The text is untrusted.',
    tags: ['experiment', 'scratch', 'files'],
    input: sandboxFilesInputSchema,
    output: sandboxFilesOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 10_000,
    retry: NO_TOOL_RETRY,
    permission: { filesystem: { read: ['scratch'] }, network: 'none' },
    run: async (input) => {
      if (input.read !== undefined) {
        const text = await deps.sandbox.readText(input.experimentId, input.read, input.maxBytes ?? MAX_TEXT);
        return text.ok ? ok({ kind: 'text' as const, path: input.read, text: text.value }) : text;
      }
      const files = await deps.sandbox.list(input.experimentId, input.dir);
      return files.ok
        ? ok({ kind: 'listing' as const, files: files.value.map((file) => ({ ...file })) })
        : files;
    },
  });
}

/** Module `sandbox`: `sandbox.run` and `sandbox.files`. */
export function sandboxToolModule(deps: SandboxToolDeps): ToolModule {
  return defineToolModule({ id: 'sandbox', tools: [runTool(deps), filesTool(deps)] });
}
