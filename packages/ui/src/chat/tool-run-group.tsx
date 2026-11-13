// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · component: tool-run-group · mode: Operate · system: DESIGN.md (A3, A12)
 * One row per operation, with useful outcomes beneath it. Repeated call status and timing are diagnostics.
 * States: running · succeeded · failed · cancelled. Status changes announce once; history stays quiet. */

import type { I18n } from '@lingui/core';
import { msg, plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { ChevronDown } from 'lucide-react';
import { Fragment, useId, useMemo, useState } from 'react';
import { Collapse } from '#components/collapse';
import { cn } from '#lib/cn';
import { useCardActions } from '../cards/card-actions';
import { TOOL_STATUS_LABELS } from '../cards/labels';
import { ToolRunRow } from '../cards/tool-run-card';
import { toolGroupLabel } from '../cards/tool-group-labels';
import { Arrival } from './arrival';
import { StatusMark } from './status-mark';
import { ToolGroupOutcomes } from './tool-group-outcomes';
import { groupToolRuns, tallyToolRuns, type RunTool, type ToolRunTally } from './tool-groups';

/** Whether something in the block arrived after it first showed (by key): only those make an entrance. */
type Arrives = (key: string) => boolean;

/** "4 of 11 done", "1 failed": how a group is going, in pieces the row shows with dots and says with commas. */
export function toolGroupWords(i18n: I18n, tally: ToolRunTally): string[] {
  const { total, done, failed, status } = tally;
  const words: string[] = [];
  if (status === 'cancelled') words.push(i18n._(TOOL_STATUS_LABELS.cancelled));
  words.push(
    status === 'succeeded'
      ? i18n._(msg`${plural(total, { one: 'Done', other: 'All # done' })}`)
      : i18n._(msg`${done} of ${total} done`),
  );
  if (failed > 0) words.push(i18n._(msg`${plural(failed, { one: '# failed', other: '# failed' })}`));
  return words;
}

/**
 * What a screen reader hears about the group: nothing while it is as it was when it showed (a chat opened from
 * history says nothing), then one line each time its status changes (it settles, or starts again). A count that
 * moves while it runs is not news; a call that fails says so itself, on its own row.
 */
function useSaid(status: ToolRunTally['status'], line: string): string {
  const [seen, setSeen] = useState(status);
  const [said, setSaid] = useState('');
  if (seen !== status) {
    setSeen(status);
    setSaid(line);
  }
  return said;
}

const CALLS = 'm-0 flex list-none flex-col gap-1.5 p-0 ps-6';

function Calls({
  calls,
  arrives,
  className,
}: {
  calls: readonly RunTool[];
  arrives: Arrives;
  className?: string;
}) {
  return (
    <ul className={cn(CALLS, className)}>
      {calls.map(({ card }) => (
        <li key={card.id}>
          <Arrival animate={arrives(`tool:${card.id}`)}>
            <ToolRunRow card={card} grouped />
          </Arrival>
        </li>
      ))}
    </ul>
  );
}

/** Developer mode reveals diagnostics on demand, without expanding the operation into a call log. */
function ToolDiagnostics({ calls, arrives }: { calls: readonly RunTool[]; arrives: Arrives }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-2 ps-6">
      <button
        type="button"
        data-slot="tool-diagnostics-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="-ms-2 flex min-h-8 w-fit items-center gap-1.5 rounded-md px-2 py-1 text-left type-meta text-ink-2 hover:bg-hover hover:text-ink active:bg-pressed"
      >
        <Trans>Tool diagnostics</Trans>
        <ChevronDown
          aria-hidden
          className={cn(
            'size-3.5 transition-transform duration-(--dur-short) ease-(--ease-out) motion-reduce:transition-none',
            open && 'rotate-180',
          )}
        />
      </button>
      <Collapse id={id} data-slot="tool-diagnostics" open={open}>
        <Calls calls={calls} arrives={arrives} className="ps-0" />
      </Collapse>
    </div>
  );
}

/** One operation row, regardless of how many individual calls performed it. */
export function ToolRunGroup({
  tool,
  calls,
  arrives,
}: {
  tool: string;
  calls: readonly RunTool[];
  arrives: Arrives;
}) {
  const { i18n } = useLingui();
  const { developerMode } = useCardActions();
  const tally = tallyToolRuns(calls);
  const label = toolGroupLabel(i18n, tool, tally.total);
  const spoken = i18n._(TOOL_STATUS_LABELS[tally.status]);
  const line = i18n._(msg`${label}: ${spoken}`);
  const said = useSaid(tally.status, line);
  return (
    <div
      data-slot="tool-group"
      data-tool={tool}
      data-status={tally.status}
      data-count={tally.total}
      className="flex min-w-0 flex-col gap-2"
    >
      <div className="flex min-w-0 items-start gap-2 type-meta text-ink-2">
        <StatusMark
          status={tally.status === 'succeeded' ? 'done' : tally.status}
          className="mt-0.5 shrink-0"
        />
        <span className="min-w-0 break-words">{label}</span>
      </div>
      <span role="status" className="sr-only">
        {said}
      </span>
      <ToolGroupOutcomes calls={calls} />
      {developerMode ? <ToolDiagnostics calls={calls} arrives={arrives} /> : null}
    </div>
  );
}

/**
 * A run's operations, oldest first. Consecutive calls share one row; a single call uses the same compact
 * presentation. Shared by plan steps and operations outside the plan.
 */
export function ToolRunList({
  tools,
  arrives,
  as = 'ul',
  className,
}: {
  tools: readonly RunTool[];
  arrives: Arrives;
  as?: 'ul' | 'div';
  className?: string;
}) {
  const entries = useMemo(() => groupToolRuns(tools), [tools]);
  const List = as;
  const Item = as === 'ul' ? 'li' : Fragment;
  return (
    <List className={cn('m-0 flex list-none flex-col gap-2 p-0', className)}>
      {entries.map((entry) => (
        <Item key={entry.key}>
          {/* Keyed by the first call: a call that a second one joins becomes the group in place, no new entrance. */}
          <Arrival animate={arrives(`tool:${entry.key}`)}>
            {entry.kind === 'call' ? (
              <ToolRunGroup tool={entry.call.card.tool} calls={[entry.call]} arrives={arrives} />
            ) : (
              <ToolRunGroup tool={entry.tool} calls={entry.calls} arrives={arrives} />
            )}
          </Arrival>
        </Item>
      ))}
    </List>
  );
}
