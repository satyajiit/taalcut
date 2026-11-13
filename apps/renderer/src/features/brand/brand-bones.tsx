// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: the brand kit editor's skeleton fixture · system: DESIGN.md v0.3 · the editor's real shape:
 * the name field and the first sections down the left, the 9:16 preview on the right */
import { Bone, BoneSection } from '../settings/bones';
import { PREVIEW_WIDTH } from './brand-preview';

function FieldBones({ count }: { count: number }) {
  return (
    <div className="flex flex-wrap gap-3">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className="flex flex-col gap-1.5">
          <span className="text-sm">
            <Bone width="6ch" />
          </span>
          <span aria-hidden className="h-9 w-32 rounded-md" />
        </span>
      ))}
    </div>
  );
}

export function EditorBones() {
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_auto]">
      <div className="flex min-w-0 flex-col gap-7">
        <span className="flex flex-col gap-1.5">
          <span className="text-sm">
            <Bone width="5ch" />
          </span>
          <span aria-hidden className="h-9 w-full max-w-md rounded-md" />
        </span>
        <BoneSection title="10%" lines={[]}>
          <FieldBones count={5} />
        </BoneSection>
        <BoneSection title="8%" lines={['30%']}>
          <FieldBones count={2} />
        </BoneSection>
      </div>
      <span
        aria-hidden
        className="block aspect-[9/16] self-start rounded-lg"
        style={{ width: PREVIEW_WIDTH }}
      />
    </div>
  );
}
