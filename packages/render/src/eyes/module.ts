// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2 eyes: the tools that show the AI its video. `video.compare` (the draft next to the reel, slot by slot) joins
 * match's `video` module (video.done) after its own tool, as `withVideoEyes` composes it: a registry takes one module
 * per id. `library.frameAt` (any clip at any
 * second, as a picture) and `library.subjects` (where people are in it) join the library package's `library` module
 * (a module's tools share its id as their prefix), as render's captureFrame joins `timeline`. The gate demo composes
 * both the same way, in the same places.
 */
import { defineToolModule, type AnyTool, type ToolModule } from '@taalcut/core';
import { videoCompareTool } from './compare-tool';
import type { EyesDeps } from './deps';
import { frameAtTool, subjectsTool } from './library-tools';

export function eyesToolModules(deps: EyesDeps): {
  readonly video: ToolModule;
  readonly library: readonly AnyTool[];
} {
  return {
    video: defineToolModule({ id: 'video', tools: [videoCompareTool(deps)] }),
    library: [frameAtTool(deps), subjectsTool(deps)],
  };
}

/** The library module with eyes' library tools after its own. */
export function withLibraryEyes(
  library: ToolModule,
  eyes: { readonly library: readonly AnyTool[] },
): ToolModule {
  return defineToolModule({ id: library.id, tools: [...library.tools, ...eyes.library] });
}

/** Match's `video` module (video.done) with eyes' video.compare after its own: one `video` module. */
export function withVideoEyes(video: ToolModule, eyes: { readonly video: ToolModule }): ToolModule {
  return defineToolModule({ id: video.id, tools: [...video.tools, ...eyes.video.tools] });
}
