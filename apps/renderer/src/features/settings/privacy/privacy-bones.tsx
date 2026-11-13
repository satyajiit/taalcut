// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: Privacy's skeleton fixture · system: DESIGN.md v0.3 · the page's real shape: Local only
 * with its switch, what each job sends, the standing consents, Help improve and the other flows */
import { BoneRows, BoneSection, type BoneRowShape } from '../bones';

const JOBS: readonly BoneRowShape[] = [
  { title: '14%', lines: ['56%'], control: 'button', icon: true },
  { title: '20%', lines: ['62%'], control: 'button', icon: true },
  { title: '18%', lines: ['50%'], control: 'button', icon: true },
  { title: '16%', lines: ['32%'], control: 'button', icon: true },
  { title: '24%', lines: ['44%'], control: 'button', icon: true },
];
const LOCAL_ONLY: readonly BoneRowShape[] = [{ title: '14%', lines: ['72%', '66%'], control: 'switch' }];

/** What leaves: the Local only row, then the jobs' section. */
export function PrivacyBones() {
  return (
    <div className="flex flex-col gap-10">
      <BoneRows rows={LOCAL_ONLY} />
      <BoneSection title="22%" lines={['70%', '40%']}>
        <BoneRows rows={JOBS} />
      </BoneSection>
    </div>
  );
}

const SWITCHES: readonly BoneRowShape[] = [
  { title: '22%', lines: ['60%', '40%'], control: 'switch' },
  { title: '20%', lines: ['58%', '30%'], control: 'switch' },
];
const FLOWS: readonly BoneRowShape[] = ['18%', '30%', '16%', '14%'].map((title) => ({ title, lines: ['44%'] }));

/** Sharing: Help improve's two switches, then the other flows. */
export function SharingBones() {
  return (
    <div className="flex flex-col gap-10">
      <BoneSection title="26%" lines={['64%']}>
        <BoneRows rows={SWITCHES} />
      </BoneSection>
      <BoneSection title="34%" lines={['50%']}>
        <BoneRows rows={FLOWS} />
      </BoneSection>
    </div>
  );
}
