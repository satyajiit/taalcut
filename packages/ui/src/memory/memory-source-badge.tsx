// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: memory source badge (LRN1-MEM) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 "AI versus you" · who a remembered item came from, as a badge with a word and a mark so it
 *   survives greyscale: what you wrote is teal (`you`, a person icon); what the agent proposed and you approved, and
 *   what Taalcut learned from your exports, are violet (`ai`, the AI mark)
 * states: static (n/a)
 */
import { Trans } from '@lingui/react/macro';
import type { MemorySource } from '@taalcut/core';
import { UserRound } from 'lucide-react';
import { AiMark } from '../components/ai-mark';
import { Badge } from '../components/badge';

export interface MemorySourceBadgeProps {
  readonly source: MemorySource;
  readonly className?: string;
}

export function MemorySourceBadge({ source, className }: MemorySourceBadgeProps) {
  if (source === 'user')
    return (
      <Badge tone="you" data-source="user" className={className}>
        <UserRound aria-hidden />
        <Trans comment="Memory item badge: the creator wrote this item">You</Trans>
      </Badge>
    );
  return (
    <Badge tone="ai" data-source={source} className={className}>
      <AiMark className="size-3" />
      {source === 'agent' ? (
        <Trans comment="Memory item badge: the agent proposed it in a chat and the creator approved it">
          Agent
        </Trans>
      ) : (
        <Trans comment="Memory item badge: Taalcut learned it from the creator's finished exports">
          Learned
        </Trans>
      )}
    </Badge>
  );
}
