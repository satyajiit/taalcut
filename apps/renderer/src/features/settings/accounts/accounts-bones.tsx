// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: Accounts' skeleton fixtures · system: DESIGN.md v0.6 + UX4 · each view's real shape: Connected
 * (what is connected, then Instagram's row), Keys (the seven providers), Subscriptions (ChatGPT, then the plans) and
 * Servers (two servers with their address fields) */
import { BoneRows, BoneSection, type BoneRowShape } from '../bones';

const key = (title: string): BoneRowShape => ({ title, control: 'button', icon: true });

export function AccountsBones() {
  return (
    <div className="flex flex-col gap-10">
      <BoneSection title="14%" lines={['46%']}>
        <BoneRows
          rows={[
            { title: '24%', lines: ['18%'], icon: true },
            { title: '12%', lines: ['10%'], icon: true },
          ]}
        />
      </BoneSection>
      <BoneSection title="22%" lines={['52%']}>
        <BoneRows rows={[{ title: '12%', lines: ['40%'], control: 'button', icon: true }]} />
      </BoneSection>
    </div>
  );
}

export function KeysBones() {
  return (
    <BoneSection title="12%" lines={['72%', '36%']}>
      <BoneRows rows={['10%', '12%', '9%', '14%', '6%', '13%', '20%'].map(key)} />
    </BoneSection>
  );
}

export function SubscriptionsBones() {
  return (
    <div className="flex flex-col gap-10">
      <BoneSection title="10%" lines={['70%', '30%']}>
        <BoneRows rows={[{ title: '24%', lines: ['40%'], control: 'button', icon: true }]} />
      </BoneSection>
      <BoneSection title="22%" lines={['70%', '28%']}>
        <BoneRows rows={['8%', '16%', '7%'].map(key)} />
      </BoneSection>
    </div>
  );
}

export function ServersBones() {
  return (
    <BoneSection title="30%" lines={['72%', '40%']}>
      <BoneRows
        rows={[
          { title: '10%', lines: ['12%', '60%', '24%'], icon: true },
          { title: '12%', lines: ['14%', '60%', '24%'], icon: true },
        ]}
      />
    </BoneSection>
  );
}
