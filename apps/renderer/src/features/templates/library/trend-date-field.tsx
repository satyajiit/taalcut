// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: trend date field (template page) · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * Set (or Change) opens a date field in place with Save, Remove date and Cancel. The date is the
 *   person's (source "user"); a reel's or the hub's is replaced only when they save one.
 * states: button default · hover · focus-visible (base ring) · active (pressed) · disabled (older version) ·
 *   editing (the field, focused) · loading (Save's spinner) · error (toast with the cause) · success (toast, Undo)
 * pre-emit critique: P5 H5 E4 S5 R4 V4
 */
import { useLingui } from '@lingui/react/macro';
import { TEMPLATE_COMMANDS, type TemplateSummary } from '@taalcut/core';
import { Button, Input } from '@taalcut/ui';
import { CalendarClock } from 'lucide-react';
import { useId, useState } from 'react';
import { useLibraryCommands } from './use-library-commands';

const today = () => new Date().toISOString().slice(0, 10);

export function TrendDateField({ summary, disabled }: { summary: TemplateSummary; disabled: boolean }) {
  const { t } = useLingui();
  const id = useId();
  const commands = useLibraryCommands();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(summary.trendFreshness?.date ?? today());

  const write = async (date: string | null) => {
    const done = await commands.run({
      steps: [
        {
          name: TEMPLATE_COMMANDS.setTrendDate,
          payload: {
            projectId: null,
            templateId: summary.id,
            trendFreshness: date ? { date, source: 'user' } : null,
          },
        },
      ],
      done: date ? t`Trend date saved` : t`Trend date cleared`,
      failed: t`Couldn’t change the trend date`,
    });
    if (done.ok) setEditing(false);
  };

  if (!editing)
    return (
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled}
        onClick={() => {
          setValue(summary.trendFreshness?.date ?? today());
          setEditing(true);
        }}
      >
        <CalendarClock aria-hidden />
        {summary.trendFreshness ? t`Change trend date` : t`Set trend date`}
      </Button>
    );

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (value) void write(value);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          setEditing(false);
        }
      }}
    >
      <label htmlFor={id} className="sr-only">
        {t`Trend date`}
      </label>
      <Input
        id={id}
        type="date"
        // The field opens because the person asked for it: it takes the cursor.
        autoFocus
        max={today()}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="h-8 w-40"
      />
      <Button size="sm" type="submit" loading={commands.pending} disabled={!value}>
        {t`Save`}
      </Button>
      {summary.trendFreshness ? (
        <Button size="sm" variant="ghost" disabled={commands.pending} onClick={() => void write(null)}>
          {t`Remove date`}
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
        {t`Cancel`}
      </Button>
    </form>
  );
}
