// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { continuousCreationMotion, creationMotionOf } from '../../src/creation/motion-contract';
import { creationSceneIds } from '../../src/creation/scenes';
import { creationFixture } from './fixture';

describe('continuous editable creation', () => {
  it('persists a shared world with exact carried-object boundaries before the styleframe', async () => {
    const fixture = creationFixture();
    expect((await fixture.director().prepare(fixture.projectId)).ok).toBe(true);
    const draft = fixture.get().draft!;
    const contract = creationMotionOf(fixture.get(), draft.revision)!;
    expect(continuousCreationMotion(contract, draft)).toBe(true);
    contract.carries[1]!.enter = { ...contract.carries[1]!.enter, x: 0.1 };
    expect(continuousCreationMotion(contract, draft)).toBe(false);
    expect(fixture.calls.every((call) => call.projectId === fixture.projectId)).toBe(true);
    expect(
      JSON.parse(fixture.calls.find((call) => call.role === 'designer')!.prompt).motionContract,
    ).not.toBeNull();
  });

  it('rejects duplicate and unscoped DOM identities before compilation', () => {
    expect(creationSceneIds('<div id="beat-1-title" data-hf-id="beat-1-title"/>', 'beat-1')).toBe(true);
    expect(creationSceneIds('<div id="cursor" data-hf-id="cursor"/>', 'beat-1')).toBe(false);
    expect(creationSceneIds('<div id="beat-1-title"/><div id="beat-1-title"/>', 'beat-1')).toBe(false);
  });
});
