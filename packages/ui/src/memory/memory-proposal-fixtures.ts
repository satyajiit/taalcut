// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- sample model output and names: data, never translated */

import type { CardOf, MemoryId, ProjectId, RunId, TemplateId } from '@taalcut/core';

/** memory.remember's card in each state worth seeing (LRN1-MEM); fixtures.ts spreads it into CARD_FIXTURES. */
const RUN = '01K7C5M6Q8R9S0T1V2W3X4Y5Z7' as RunId;
const PROJECT = '01K7C5M6Q8R9S0T1V2W3X4Y5ZP' as ProjectId;
const TEMPLATE = '01K7C5M6Q8R9S0T1V2W3X4Y5ZT' as TemplateId;
const MEMORY = '01K7C5M6Q8R9S0T1V2W3X4Y5ZM' as MemoryId;

const proposal = (
  name: string,
  status: CardOf<'memoryProposal'>['status'],
  extra: Partial<CardOf<'memoryProposal'>> = {},
): CardOf<'memoryProposal'> => ({
  type: 'memoryProposal',
  id: `memory-${name}`,
  version: 1,
  runId: RUN,
  approvalId: `memory-ap-${name}`,
  text: 'Never use whip transitions.',
  scope: { kind: 'user' },
  scopeName: null,
  status,
  ...extra,
});

export const MEMORY_PROPOSAL_FIXTURES: Readonly<Record<string, CardOf<'memoryProposal'>>> = {
  pending: proposal('pending', 'pending'),
  project: proposal('project', 'pending', {
    text: 'Open every cut of this reel on the drone shot over the market.',
    scope: { kind: 'project', projectId: PROJECT },
    scopeName: 'Golden hour market',
  }),
  template: proposal('template', 'approved', {
    text: 'Keep the captions in the lower third with this template.',
    scope: { kind: 'template', templateId: TEMPLATE },
    scopeName: 'Slow morning routine',
  }),
  remembered: proposal('remembered', 'remembered', { memoryId: MEMORY }),
  declined: proposal('declined', 'declined'),
};
