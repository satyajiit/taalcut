// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type FindingSeverity, type UsabilitySession } from './schema';
import { SYNTHETIC_NOTE } from './summary';

const SEVERITY_RANK: Record<FindingSeverity, number> = { high: 0, medium: 1, low: 2 };

export interface DraftWorkPackage {
  /** First session's wording, with surrounding space collapsed. Not a work-package id. */
  what: string;
  severity: FindingSeverity;
  area: string;
  evidence: string;
  sessions: string[];
}

/** Trim, collapse whitespace, and case-fold so the same note in two sessions is one draft. */
export function normaliseWhat(what: string): string {
  return what.trim().replace(/\s+/g, ' ').toLowerCase();
}

function displayWhat(what: string): string {
  return what.trim().replace(/\s+/g, ' ');
}

function higherSeverity(current: FindingSeverity, next: FindingSeverity): FindingSeverity {
  return SEVERITY_RANK[next] < SEVERITY_RANK[current] ? next : current;
}

interface Group {
  what: string;
  severity: FindingSeverity;
  areas: string[];
  evidence: string[];
  sessions: string[];
}

/**
 * One draft per normalised `what`. Rank high, then medium, then low.
 * Within a severity, more sessions come first. If severities disagree, the higher one wins
 * so a high report is not hidden under a later low wording of the same note.
 */
export function groupFindings(sessions: readonly UsabilitySession[]): DraftWorkPackage[] {
  const groups = new Map<string, Group>();
  for (const session of sessions) {
    for (const finding of session.findings) {
      const key = normaliseWhat(finding.what);
      const existing = groups.get(key);
      if (existing === undefined) {
        groups.set(key, {
          what: displayWhat(finding.what),
          severity: finding.severity,
          areas: [finding.area],
          evidence: [finding.evidence],
          sessions: [session.sessionId],
        });
        continue;
      }
      existing.severity = higherSeverity(existing.severity, finding.severity);
      if (!existing.areas.includes(finding.area)) existing.areas.push(finding.area);
      if (!existing.evidence.includes(finding.evidence)) existing.evidence.push(finding.evidence);
      if (!existing.sessions.includes(session.sessionId)) existing.sessions.push(session.sessionId);
    }
  }
  const drafts = [...groups.values()].map((group) => ({
    what: group.what,
    severity: group.severity,
    area: group.areas.join('; '),
    evidence: group.evidence.join('; '),
    sessions: group.sessions,
  }));
  drafts.sort((left, right) => {
    const bySeverity = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
    if (bySeverity !== 0) return bySeverity;
    const byCount = right.sessions.length - left.sessions.length;
    if (byCount !== 0) return byCount;
    return left.what.localeCompare(right.what, 'en');
  });
  return drafts;
}

const DRAFT_NOTE =
  'These are drafts for the PO to file the same week. They are not filed work packages, and this file does not assign work-package ids.';

export function findingsMarkdown(sessions: readonly UsabilitySession[]): string {
  const drafts = groupFindings(sessions);
  const lead = sessions.some((session) => session.synthetic)
    ? `${SYNTHETIC_NOTE}\n\n${DRAFT_NOTE}`
    : DRAFT_NOTE;
  if (drafts.length === 0) return `${lead}\n\nThere are none.\n`;
  const blocks = drafts.map((draft) =>
    [
      `## Draft WP: ${draft.what}`,
      `- Severity: ${draft.severity}`,
      `- Area: ${draft.area}`,
      `- Evidence: ${draft.evidence}`,
      `- Sessions: ${draft.sessions.join(', ')}`,
    ].join('\n'),
  );
  return `${lead}\n\n${blocks.join('\n\n')}\n`;
}
