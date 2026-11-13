// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- sample model output: data, never translated */

import type { CardOf, EditTarget, ProjectId, RunId, TimelineId, TimelineItemId } from '@taalcut/core';

/** The changes card in each state worth seeing (EDT1-CTX); fixtures.ts spreads it into CARD_FIXTURES. */
const RUN = '01K7C5M6Q8R9S0T1V2W3X4Y5Z7' as RunId;
const PROJECT = '01K7C5M6Q8R9S0T1V2W3X4Y5ZP' as ProjectId;
const TIMELINE = '01K7C5M6Q8R9S0T1V2W3X4Y5ZQ' as TimelineId;
const id = (n: number) => `01K7C5M6Q8R9S0T1V2W3X4Y6${String(n).padStart(2, '0')}` as TimelineItemId;
const item = (n: number, itemKind: Extract<EditTarget, { kind: 'item' }>['itemKind']): EditTarget => ({
  kind: 'item',
  timelineId: TIMELINE,
  itemId: id(n),
  itemKind,
});

const changes = (name: string, rows: CardOf<'editChanges'>['changes'], more = 0): CardOf<'editChanges'> => ({
  type: 'editChanges',
  id: `edit-changes-${name}`,
  version: 1,
  runId: RUN,
  projectId: PROJECT,
  timelineId: TIMELINE,
  group: `turn:${RUN}`,
  revisionBefore: 4,
  revisionAfter: 6,
  changes: rows,
  more,
});

export const EDIT_CHANGES_FIXTURES: Readonly<Record<string, CardOf<'editChanges'>>> = {
  shorter: changes('shorter', [
    { target: item(3, 'clip'), number: 3, at: 3, change: { kind: 'length', before: 2.4, after: 1.8 } },
  ]),
  many: changes(
    'many',
    [
      {
        target: item(1, 'text'),
        number: 1,
        role: 'title',
        at: 0,
        change: { kind: 'words', before: 'Morning in the hills', after: 'Sunrise run' },
      },
      {
        target: item(2, 'graphic'),
        number: 1,
        at: 2.5,
        change: { kind: 'place', before: 'bottom', after: 'top' },
      },
      { target: item(4, 'clip'), number: 4, at: 5, change: { kind: 'speed', before: 1, after: 0.5 } },
      { target: item(5, 'transition'), number: 2, at: 6.2, change: { kind: 'added' } },
      { target: item(6, 'clip'), number: 2, at: 1.2, change: { kind: 'order', before: 5, after: 2 } },
      { target: item(7, 'audio'), number: 1, at: 0, change: { kind: 'volume', before: 0, after: -6 } },
      {
        target: { kind: 'timeline', timelineId: TIMELINE },
        number: null,
        at: null,
        change: { kind: 'setting', what: 'captions' },
      },
    ],
    3,
  ),
  nothing: changes('nothing', []),
};
