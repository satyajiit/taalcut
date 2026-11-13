// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent's image providers read each still's C2PA presence from its bytes through core's ContentCredentials
 * (contract round P3-3, `readBytes`), when the process has it (render-phase3-agent.ts registers it).
 */
import { describe, expect, it } from 'vitest';
import { ContentCredentialsToken, createContainer, ok, type ContentCredentials } from '@taalcut/core';
import { stillCredentials } from '../src/utility/roots/agent-images';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

describe('agent image providers: C2PA presence', () => {
  it("reads a still's bytes through ContentCredentials.readBytes", async () => {
    const seen: string[] = [];
    const credentials: ContentCredentials = {
      read: async () => ok({ presence: 'unknown', summary: null }),
      readBytes: async (bytes, mediaType) => {
        seen.push(`${mediaType} ${bytes.length}`);
        return ok({ presence: 'absent', summary: null });
      },
    };
    const container = createContainer().value(ContentCredentialsToken, credentials);
    const { contentCredentials } = stillCredentials(container);
    expect(await contentCredentials?.(PNG, 'image/png')).toBe('absent');
    expect(seen).toEqual(['image/png 4']);
  });

  it("says 'unknown' when the credentials can't read bytes, and has no reader without them", async () => {
    const container = createContainer().value(ContentCredentialsToken, {
      read: async () => ok({ presence: 'present', summary: null }),
    });
    expect(await stillCredentials(container).contentCredentials?.(PNG, 'image/png')).toBe('unknown');
    expect(stillCredentials(createContainer())).toEqual({});
  });
});
