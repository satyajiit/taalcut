// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * Hallmark · component: Settings › Memory › add (LRN1-MEM) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · the words (MemoryTextField) with Add, the screen's one marigold fill, beside them, and
 *   under them where the item applies (MemoryScopeField: every video, or a project or template picked by name). The
 *   choice stays after an add, so several notes for one project go in a row
 * states: default · adding (Add spins, the field waits) · add failed (the cause under the field) · waiting for a
 *   choice (a project or template still to pick: Add waits, the picker's button says what to choose) · success
 *   (the field clears; the list shows the item in its group)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { MEMORY_TEXT_MAX } from '@taalcut/core';
import { Button, ErrorLine, MemoryScopeField, MemoryTextField } from '@taalcut/ui';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { EVERY_VIDEO } from './memory-scope';
import type { MemoryActions } from './use-memory-actions';
import { useScopeChoice } from './use-scope-choice';

export function AddField({ actions }: { actions: MemoryActions }) {
  const { t } = useLingui();
  const [text, setText] = useState('');
  const where = useScopeChoice(EVERY_VIDEO);
  const trimmed = text.trim();
  const ready = trimmed.length > 0 && where.scope !== null;
  const add = async () => {
    if (!ready || !where.scope || actions.adding) return;
    if (await actions.add(trimmed, where.scope)) setText('');
  };
  return (
    <div className="flex flex-col gap-2" data-slot="memory-add">
      <div className="flex items-start gap-2">
        <MemoryTextField
          value={text}
          max={MEMORY_TEXT_MAX}
          onValueChange={(value) => {
            setText(value);
            if (actions.addError) actions.clearAddError();
          }}
          onSubmit={() => void add()}
          saving={actions.adding}
          invalid={Boolean(actions.addError)}
          aria-label={t`Something to remember`}
          placeholder={t`Something to remember, like “never use whip transitions”`}
        />
        <Button
          variant="primary"
          data-action="add-memory"
          loading={actions.adding}
          disabled={!ready}
          onClick={() => void add()}
        >
          <Plus aria-hidden />
          <Trans>Add</Trans>
        </Button>
      </div>
      <MemoryScopeField {...where.field} disabled={actions.adding} />
      {actions.addError ? <ErrorLine key={actions.addError.code} error={actions.addError} /> : null}
    </div>
  );
}
