// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { err, RationalTime, ValidationError } from '@taalcut/core';
import type { CompositionLayer } from '../compile/layer';
import { compositionsLayer } from '../compile/layers/compositions';
import { assetReferences } from '../workspace/gate/assets';
import type { CompositionPlacement, WorkspaceReader, AssetLink } from '../workspace/fold/types';
import { prepareAuthoredProgram } from './prepare';

/** A missing program is fatal: exporting an empty film must never look like a successful render. */
export function authoredProgramsLayer(reader: WorkspaceReader | undefined): CompositionLayer {
  return {
    id: 'authoredPrograms',
    build(context) {
      const placements: CompositionPlacement[] = [];
      const invalid = (detail: string) => err(ValidationError({ field: 'authoredProgram' }, { detail }));
      for (const planned of context.plan.programs ?? []) {
        const entry = planned.program.files.find((file) => file.path === planned.program.entry);
        const source = entry ? reader?.text(entry.sha256) : undefined;
        if (source === undefined) return invalid('The authored program source is unavailable.');
        const prepared = prepareAuthoredProgram(source);
        if (!prepared.ok)
          return invalid(
            prepared.findings.map((finding) => `${finding.message} ${finding.fixHint}`).join('\n'),
          );
        const assets: Record<string, AssetLink> = {};
        for (const path of assetReferences(prepared.value)) {
          const file = planned.program.files.find((candidate) => candidate.path === path);
          const found = file ? reader?.asset(file.sha256) : undefined;
          if (!file || !found) return invalid('An authored program asset is unavailable.');
          assets[path] = {
            bundlePath: `authored/${file.sha256}.${found.ext}`,
            source: found.file,
            key: file.sha256,
          };
        }
        placements.push({
          itemId: planned.itemId,
          span: planned.span,
          composition: prepared.value,
          values: {},
          sourceStart: RationalTime.toSeconds(planned.sourceStart),
          assets,
        });
      }
      return compositionsLayer(placements, undefined).build(context);
    },
  };
}
