// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { GraphicBrief, Template } from '@taalcut/core';
import { act, fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TemplateReview } from '../src/index';
import { reviewEditCommand } from '../src/templates/use-review-edits';
import { templateFixture } from './template-fixture';

// DSG1-READ: each text line's graphic brief in the review, editable, with Not a graphic and its restore.

const ok = <T,>(value: T) => ({ ok: true as const, value });
const SIGN = '01JDSG1READS1GN00000000002';

function brief(overlayId: GraphicBrief['overlayId'], over: Partial<GraphicBrief> = {}): GraphicBrief {
  return {
    overlayId,
    graphic: true,
    reason: null,
    kind: 'title',
    what: 'the reel’s title card',
    role: 'hook',
    answers: null,
    look: {
      words: 'big white rounded type on the picture',
      platform: 'neutral',
      shadow: false,
      avatar: false,
    },
    motion: { words: 'pops in, cuts out', typingSeconds: null },
    timing: { cue: 'beat', words: 'comes on on a beat' },
    people: { words: 'in the top third of the frame' },
    source: 'model',
    confidence: 0.85,
    ...over,
  };
}

function withBriefs(): Template {
  const base = templateFixture();
  const title = base.text[0]!;
  const sign = { ...title, id: SIGN as typeof title.id, text: 'CHAI POINT', role: 'label' as const };
  return {
    ...base,
    text: [title, sign],
    graphics: {
      uses: [],
      reading: {
        version: 1,
        prompt: 'graphic-brief/1',
        model: { provider: 'local-runtime', model: 'qwen3.5-4b', local: true },
        briefs: [
          brief(title.id),
          brief(sign.id, {
            graphic: false,
            reason: 'A shop’s name painted on its front, in the scene',
            kind: 'other',
            what: 'a shop sign',
            role: 'other',
          }),
        ],
        system: {
          tokens: { platform: 'neutral', fills: [], text: ['#ffffff'], cornerRadius: null, font: null },
          conversation: [],
          stack: null,
          words: '1 other graphic in the same look.',
        },
      },
    },
  };
}

function view(template: Template) {
  const dispatch = vi.fn(async (_name: string, _payload: unknown) =>
    ok({ result: { templateId: template.id, version: template.version + 1 } }),
  );
  render(
    <I18nProvider i18n={i18n}>
      <TemplateReview
        variant="sheet"
        template={template}
        reelUrl={null}
        sheetUrl={null}
        projectId={null}
        dispatch={dispatch}
        undo={async () => ok(null)}
      />
    </I18nProvider>,
  );
  return dispatch;
}

const said = () => document.querySelector('[data-slot=review-said]')?.textContent;
const at = (template: Template) => ({
  projectId: null,
  templateId: template.id,
  baseVersion: template.version,
});
const briefs = () => [...document.querySelectorAll<HTMLElement>('[data-slot=graphic-brief]')];

describe('a graphic’s brief in the review (DSG1-READ)', () => {
  it('says what it is, its part in the story, its look, motion, timing and place, as Taalcut read it', () => {
    view(withBriefs());
    const [title] = briefs();
    const brief = within(title!);
    expect(brief.getByText('Title')).toBeTruthy();
    expect(brief.getByText('Hook')).toBeTruthy();
    expect(brief.getByText('the reel’s title card')).toBeTruthy();
    expect(brief.getByText('Look')).toBeTruthy();
    expect(brief.getByText('big white rounded type on the picture')).toBeTruthy();
    expect(brief.getByText('pops in, cuts out')).toBeTruthy();
    expect(brief.getByText('comes on on a beat')).toBeTruthy();
    expect(brief.getByText('in the top third of the frame')).toBeTruthy();
    expect(brief.getByLabelText('Taalcut’s reading')).toBeTruthy();
  });

  it('Not a graphic leaves it out of made videos, undoably', async () => {
    const template = withBriefs();
    const dispatch = view(template);
    await act(async () =>
      fireEvent.click(within(briefs()[0]!).getByRole('button', { name: 'Not a graphic' })),
    );
    expect(dispatch).toHaveBeenLastCalledWith('template.graphic.set', {
      ...at(template),
      overlayId: template.text[0]!.id,
      graphic: false,
    });
    expect(said()).toBe('Left out: not a graphic');
  });

  it('a reading of footage shows as removed, with its reason, and Restore puts it back', async () => {
    const template = withBriefs();
    const dispatch = view(template);
    const sign = briefs()[1]!;
    expect(sign.dataset.removed).toBeDefined();
    expect(within(sign).getByText(/Not a graphic: footage the reel filmed/)).toBeTruthy();
    expect(within(sign).getByText('A shop’s name painted on its front, in the scene')).toBeTruthy();
    // The removed line offers Restore, not Not text.
    const line = sign.closest('li')!;
    expect(within(line).queryByRole('button', { name: 'Not text' })).toBeNull();
    await act(async () =>
      fireEvent.click(within(sign).getByRole('button', { name: 'Restore as a graphic' })),
    );
    expect(dispatch).toHaveBeenLastCalledWith('template.graphic.set', {
      ...at(template),
      overlayId: SIGN,
      graphic: true,
    });
    expect(said()).toBe('Restored as a graphic');
  });

  it('Edit the brief changes only what the person changed', async () => {
    const template = withBriefs();
    const dispatch = view(template);
    const title = within(briefs()[0]!);
    fireEvent.click(title.getByRole('button', { name: 'Edit the brief' }));
    fireEvent.change(title.getByLabelText('Part in the story'), { target: { value: 'payoff' } });
    fireEvent.change(title.getByLabelText('In a few words'), { target: { value: 'the closing line' } });
    await act(async () => fireEvent.click(title.getByRole('button', { name: 'Save' })));
    expect(dispatch).toHaveBeenLastCalledWith('template.graphic.edit', {
      ...at(template),
      overlayId: template.text[0]!.id,
      brief: { role: 'payoff', what: 'the closing line' },
    });
    expect(said()).toBe('Graphic brief changed');
  });

  it('a person’s brief is led by You', () => {
    const template = withBriefs();
    template.graphics!.reading!.briefs[0] = { ...template.graphics!.reading!.briefs[0]!, source: 'person' };
    view(template);
    expect(within(briefs()[0]!).getByText('You')).toBeTruthy();
  });

  it('makes both commands on the version on screen', () => {
    const template = withBriefs();
    const overlayId = template.text[0]!.id;
    expect(reviewEditCommand(template, null, { kind: 'setGraphic', overlayId, graphic: false }, 6)).toEqual({
      name: 'template.graphic.set',
      payload: { projectId: null, templateId: template.id, baseVersion: 6, overlayId, graphic: false },
    });
    expect(
      reviewEditCommand(template, null, { kind: 'editBrief', overlayId, brief: { look: 'blue' } }).name,
    ).toBe('template.graphic.edit');
  });
});
