// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { newId, PROJECT_COMMANDS, projectCommandPayloads } from '../src/index';

describe('project rename expectations', () => {
  const rename = projectCommandPayloads[PROJECT_COMMANDS.rename];
  const projectId = newId<'Project'>();

  it('keeps ordinary rename payloads compatible', () => {
    expect(rename.parse({ projectId, name: ' Airport Reel ' })).toEqual({
      projectId,
      name: 'Airport Reel',
    });
  });

  it('preserves the expected automatic name for an atomic rename', () => {
    expect(
      rename.parse({ projectId, name: 'Airport Reel', expectedName: 'Instagram reel breakdown' }),
    ).toEqual({ projectId, name: 'Airport Reel', expectedName: 'Instagram reel breakdown' });
  });

  it.each(['', ' '.repeat(3), 'a'.repeat(201)])('rejects an invalid expected name', (expectedName) => {
    expect(rename.safeParse({ projectId, name: 'Airport Reel', expectedName }).success).toBe(false);
  });

  it('validates the conversation used for guarded automatic naming', () => {
    const fromConversation = newId<'Conversation'>();
    expect(rename.parse({ projectId, name: 'Airport Reel', fromConversation }).fromConversation).toBe(
      fromConversation,
    );
    expect(rename.safeParse({ projectId, name: 'Airport Reel', fromConversation: 'invalid' }).success).toBe(
      false,
    );
  });
});
