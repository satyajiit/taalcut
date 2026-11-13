// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: External agents' skeleton fixture · system: DESIGN.md v0.3 · the page's real shape: the
 * switch row and the server's line */
import { Bone, BoneRows, BoneSection } from '../bones';

export function ExternalAgentsBones() {
  return (
    <BoneSection title="22%" lines={[]}>
      <BoneRows rows={[{ title: '34%', lines: ['68%', '60%', '12%'], control: 'switch' }]} />
      <span className="type-body">
        <Bone width="30%" />
      </span>
    </BoneSection>
  );
}
