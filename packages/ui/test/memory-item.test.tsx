// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Settings → Memory's item in the kit (LRN1-MEM): when it last changed is Intl's words in a `<time>` carrying the
 * moment, as every Intl-formatted moment in the kit is (the pseudo-locale check exempts it).
 */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { MemoryId } from '@taalcut/core';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryItem } from '../src/index';

// A fixture id, branded as the kit's fixtures brand theirs.
const id = '01K7C5M6Q8R9S0T1V2W3X4Y5ZN' as MemoryId;
const updatedAt = Date.UTC(2026, 9, 18, 9, 30);

describe('MemoryItem', () => {
  it('says when it last changed in a <time> with the moment', () => {
    const { container } = render(
      <I18nProvider i18n={i18n}>
        <MemoryItem
          item={{ id, text: 'Keep cuts on the beat', source: 'user', updatedAt }}
          max={500}
          editing={false}
          busy={null}
          now={updatedAt + 3 * 86_400_000}
          onEdit={vi.fn()}
          onCancel={vi.fn()}
          onSave={vi.fn()}
          onDelete={vi.fn()}
        />
      </I18nProvider>,
    );
    const time = container.querySelector('[data-slot=memory-item] time');
    expect(time?.getAttribute('dateTime')).toBe(new Date(updatedAt).toISOString());
    expect(time?.textContent).not.toBe('');
  });
});
