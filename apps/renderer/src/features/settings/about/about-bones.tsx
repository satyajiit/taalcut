// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: This Mac's skeleton fixture · system: DESIGN.md v0.6 + UX4 · the page's real shape: the
 * hardware section (its tier line and facts), then where work runs */
import { BoneRows, BoneSection, type BoneRowShape } from '../bones';

const facts: readonly BoneRowShape[] = ['18%', '24%', '14%', '16%', '12%', '20%'].map((title) => ({
  title,
}));
const jobs: readonly BoneRowShape[] = ['12%', '20%', '14%', '22%'].map((title) => ({
  title,
  lines: ['14%'],
}));

export function AboutBones() {
  return (
    <div className="flex flex-col gap-10">
      <BoneSection title="12%" lines={['48%', '64%']}>
        <BoneRows rows={facts} />
      </BoneSection>
      <BoneSection title="28%" lines={['54%']}>
        <BoneRows rows={jobs} />
      </BoneSection>
    </div>
  );
}
