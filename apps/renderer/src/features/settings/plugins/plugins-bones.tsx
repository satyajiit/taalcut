// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { BoneHeading, BoneRows, BoneSection } from '../bones';

export function PluginsBones({ detail = false }: { detail?: boolean }) {
  return (
    <div className="flex flex-col gap-8">
      <BoneSection title="24%" lines={['60%']}>
        <BoneRows rows={[{ title: '18%', lines: ['60%', '28%'], control: 'button', icon: true }]} />
      </BoneSection>
      {detail ? (
        <>
          <BoneHeading title="20%" />
          <BoneRows
            rows={[
              { title: '22%', lines: ['58%'], control: 'switch' },
              { title: '30%', lines: ['62%'], control: 'switch' },
            ]}
          />
        </>
      ) : null}
    </div>
  );
}
