// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { act, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { useFocusFallback } from '../src';

function Chat() {
  const root = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [step, setStep] = useState<'asking' | 'exporting' | 'gone'>('asking');
  useFocusFallback(root, () => field.current);
  return (
    <div ref={root}>
      {step === 'gone' ? null : (
        <article data-slot="smart-card" aria-label="Export">
          {step === 'asking' ? (
            <button key="export" type="button" onClick={() => setStep('exporting')}>
              Export
            </button>
          ) : (
            <button key="done" type="button" onClick={() => setStep('gone')}>
              Done
            </button>
          )}
        </article>
      )}
      <textarea ref={field} aria-label="Message" />
    </div>
  );
}

describe('useFocusFallback', () => {
  it('keeps focus on the card when its button goes, and in the composer when the card goes', async () => {
    render(<Chat />);
    const exportButton = screen.getByRole('button', { name: 'Export' });
    exportButton.focus();
    act(() => exportButton.click());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('article', { name: 'Export' })));
    expect(screen.getByRole('article').tabIndex).toBe(-1);

    const done = screen.getByRole('button', { name: 'Done' });
    done.focus();
    act(() => done.click());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message' })),
    );
  });

  it('leaves focus alone when it went somewhere on purpose', async () => {
    render(<Chat />);
    const field = screen.getByRole('textbox', { name: 'Message' });
    const exportButton = screen.getByRole('button', { name: 'Export' });
    exportButton.focus();
    field.focus();
    act(() => exportButton.click());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.activeElement).toBe(field);
  });
});
