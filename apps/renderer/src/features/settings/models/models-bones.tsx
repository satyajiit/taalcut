// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: Models' skeleton fixture · system: DESIGN.md v0.5 · the page's real shape: the profile
 * list's four radio rows, the models for this Mac (UX2-DOWNLOADER: the summary line over its bar, then a hairline
 * row per job, the job and its parts at the left, the state at the right), then Advanced with its button */
import { Bone, BoneRows, BoneSection } from '../bones';

/** "Models for this Mac": the summary line and its bar, then the job rows, as wide as the section. */
function DownloadRowBones() {
  return (
    <div className="flex flex-col gap-4">
      <span className="flex flex-col gap-2">
        <Bone width="36%" />
        <Bone width="100%" className="h-1 rounded-pill" />
      </span>
      <span className="flex flex-col">
        {['24%', '30%', '22%', '18%', '20%', '34%', '23%', '26%'].map((width) => (
          <span
            key={width}
            className="flex items-center justify-between gap-4 border-t border-rule-subtle py-2.5 type-body first:border-t-0"
          >
            <Bone width={width} />
            <Bone width="6ch" />
          </span>
        ))}
      </span>
    </div>
  );
}

export function ModelsBones() {
  return (
    <div className="flex flex-col gap-8">
      <BoneSection title="26%" lines={['48%']}>
        <BoneRows
          rows={[
            { title: '14%', lines: ['46%'], icon: true },
            { title: '12%', lines: ['42%'], icon: true },
            { title: '13%', lines: ['50%'], icon: true },
            { title: '11%', lines: ['56%'], icon: true },
          ]}
        />
      </BoneSection>
      <BoneSection title="22%" lines={['54%']}>
        <DownloadRowBones />
      </BoneSection>
      <BoneSection title="12%" lines={['58%']} />
    </div>
  );
}
