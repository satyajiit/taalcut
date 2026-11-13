// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { TaalcutError } from '@taalcut/core';

/** Compiler diagnostics are source validation, so a new bounded model attempt can repair them. */
export function creationRepairNotes(error: TaalcutError): readonly string[] | null {
  return error.code === 'agent.creation_output_invalid' ||
    (error.code === 'core.validation' && error.params?.['field'] === 'authoredProgram')
    ? [
        `${error.code}: ${error.detail ?? 'Correct the source to meet the editable program contract.'}`.slice(
          0,
          2000,
        ),
      ]
    : null;
}
