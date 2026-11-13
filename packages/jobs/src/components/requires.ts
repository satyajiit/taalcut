// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A component's `requires` (LNX1 seam 4): what a machine must have for the component to run, beyond an artifact
 * for its platform. A CUDA build needs an NVIDIA GPU, a new enough driver and compute capability; a Core ML model
 * needs a new enough macOS. machine-fit.ts checks it against the machine's description.
 *
 * The values are open strings, not enums, so a newer manifest naming a GPU API this build has never heard of still
 * parses: that requirement simply never holds here. A key this build doesn't know (a newer manifest's) also never
 * holds: a requirement that can't be checked keeps the component off the machine rather than risk a binary that
 * can't run.
 */
import { z } from 'zod';

const DottedVersion = z
  .string()
  .max(32)
  .regex(/^\d+(?:\.\d+)*$/);

const Word = z
  .string()
  .max(32)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/** The requirement keys this build checks; any other key in `requires` fails the fit. */
export const KNOWN_REQUIREMENTS = [
  'platform',
  'minOsVersion',
  'gpuApi',
  'minDriver',
  'minComputeCapability',
  'minVramBytes',
  'minGlibc',
] as const;

const GPU_ONLY = ['minDriver', 'minComputeCapability', 'minVramBytes'] as const;

export const ComponentRequiresSchema = z
  .looseObject({
    platform: Word.optional().describe(
      "process.platform the component runs on, e.g. 'darwin'. Artifacts already say the platform; this one is for minOsVersion.",
    ),
    minOsVersion: DottedVersion.optional().describe(
      "Lowest OS version, dotted, e.g. '15' for macOS 15. Needs `platform`.",
    ),
    gpuApi: Word.optional().describe(
      "A GPU of the machine must offer this API: 'cuda', 'vulkan', 'metal', 'directml', 'rocm'.",
    ),
    minDriver: DottedVersion.optional().describe(
      "Lowest driver version of that GPU, dotted, e.g. '580' for CUDA 13. Needs `gpuApi`.",
    ),
    minComputeCapability: DottedVersion.optional().describe(
      "Lowest CUDA compute capability of that GPU, e.g. '7.5' (Turing). Needs `gpuApi`.",
    ),
    minVramBytes: z
      .int()
      .positive()
      .optional()
      .describe('Least dedicated video memory on that GPU, in bytes.'),
    minGlibc: DottedVersion.optional().describe(
      "Lowest glibc the machine must run, e.g. '2.38' for an upstream Linux build made on Ubuntu 24.04.",
    ),
  })
  .superRefine((requires, ctx) => {
    for (const key of GPU_ONLY)
      if (requires[key] !== undefined && requires.gpuApi === undefined)
        ctx.addIssue({ code: 'custom', message: `${key} needs gpuApi.`, path: [key] });
    if (requires.minOsVersion !== undefined && requires.platform === undefined)
      ctx.addIssue({ code: 'custom', message: 'minOsVersion needs platform.', path: ['minOsVersion'] });
  })
  .describe(
    "What the machine must have for this component to run (LNX1 seam 4). A key this build doesn't know never holds, so the component isn't installed where it can't be checked.",
  );

export type ComponentRequires = z.output<typeof ComponentRequiresSchema>;
