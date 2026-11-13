// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { authoredEditSchema, type AuthoredEdit } from '@taalcut/core';
import { useState } from 'react';
import { CreationText } from '../../create/create-fields';
import { Field, Notice } from '../../settings/fields';

export type SaveAuthoredEdits = (edits: AuthoredEdit[]) => Promise<boolean>;

export function ObjectField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field htmlFor={id} label={label}>
      <CreationText
        id={id}
        value={value}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

export function useValidatedEdit(save: SaveAuthoredEdits) {
  const { t } = useLingui();
  const [invalid, setInvalid] = useState(false);
  const run = async (build: () => unknown[]) => {
    try {
      const edits = build().map((edit) => authoredEditSchema.parse(edit));
      setInvalid(false);
      if (!edits.length) return true;
      return await save(edits);
    } catch {
      setInvalid(true);
      return false;
    }
  };
  return {
    run,
    error: invalid ? (
      <Notice tone="danger" role="alert">{t`Check the values and JSON syntax before saving.`}</Notice>
    ) : null,
  };
}
