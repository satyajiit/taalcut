// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1 tpl: a template made from a reel has its graphics designed once, as compositions, after its creation
 * commits: the template's id from the command's audit entry, the Designer's compositions set on its head with its
 * version, and nothing for a template without graphic overlays, one that has compositions, or one made outside a
 * project. A template's kept reel is waited for.
 */
import { describe, expect, it } from 'vitest';
import {
  newId,
  ok,
  TEMPLATE_COMMANDS,
  type CommandListener,
  type GraphicComposition,
  type GraphicComponents,
  type OverlayDesign,
  type ProjectId,
  type Template,
  type TemplateId,
} from '@taalcut/core';
import type { TemplateDesignOutcome } from '@taalcut/render';
import {
  keptReel,
  startTemplateDesign,
  wantsDesign,
  type TemplateDesigning,
} from '../src/utility/roots/agent-template-designing';
import { createTemplateDesignTracker } from '../src/utility/roots/template-design-tracker';

const BUBBLE: OverlayDesign = {
  kind: 'chatBubble',
  colors: { fill: '#ffffff', text: '#111111', stroke: null },
  cornerRadius: 0.36,
  tail: 'left',
  font: { class: 'sans', weight: 400 },
  motion: { enter: 'pop', exit: 'none', typing: false },
  shape: { x: 0.06, y: 0.38, width: 0.43, height: 0.045 },
  confidence: 0.9,
};

const templateOf = (id: TemplateId, part: Partial<Template> = {}): Template =>
  ({
    id,
    version: 3,
    text: [{ id: newId<'TextOverlay'>(), design: BUBBLE }],
    ...part,
  }) as unknown as Template;

/** A bus, audit log, template service and design, each a stand-in that records what it was asked. */
function standIns(
  template: Template,
  made: GraphicComponents | null,
  options: { outcomes?: readonly TemplateDesignOutcome[]; gate?: Promise<void> } = {},
) {
  const tracker = createTemplateDesignTracker();
  let listener: CommandListener = () => undefined;
  const commandId = newId<'Command'>();
  const dispatched: { name: string; payload: unknown }[] = [];
  const designed: ProjectId[] = [];
  const designing: TemplateDesigning = {
    bus: {
      subscribe: (next) => {
        listener = next;
        return () => undefined;
      },
      dispatch: (async (name: string, payload: unknown) => {
        dispatched.push({ name, payload });
        return ok({ result: {}, inverse: null });
      }) as never,
    },
    audit: {
      listByProject: async () => ok([{ id: commandId, payload: { template: { id: template.id } } }] as never),
    },
    templates: { get: async () => ok({ template } as never) },
    tracker,
    design: async (_template, projectId) => {
      designed.push(projectId);
      await options.gate;
      return made ? { graphics: made, outcomes: options.outcomes ?? [] } : null;
    },
  };
  startTemplateDesign(designing);
  const created = (projectId: ProjectId | null) =>
    listener({
      kind: 'executed',
      id: commandId,
      name: TEMPLATE_COMMANDS.create,
      projectId,
      origin: { source: 'ui', actor: 'person' },
    });
  // The queue runs after the listener returns.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  return { created, settle, dispatched, designed, tracker };
}

const composition = { id: newId<'GraphicComposition'>() } as unknown as GraphicComposition;

describe('a template’s graphics designed after it is made (HFW1 tpl)', () => {
  it('designs a new template’s graphics in its project and sets them on its head', async () => {
    const template = templateOf(newId<'Template'>());
    const overlayId = template.text[0]!.id;
    const made = { uses: [{ overlayId, compositionId: composition.id }], compositions: [composition] };
    const run = standIns(template, made as unknown as GraphicComponents);
    const projectId = newId<'Project'>();
    run.created(projectId);
    await run.settle();
    expect(run.designed).toEqual([projectId]);
    expect(run.dispatched).toEqual([
      {
        name: TEMPLATE_COMMANDS.setGraphics,
        payload: { projectId: null, templateId: template.id, baseVersion: 3, graphics: made },
      },
    ]);
  });

  it('sets nothing when no composition was kept, and designs nothing outside a project', async () => {
    const template = templateOf(newId<'Template'>());
    const none = standIns(template, { uses: [], compositions: [] } as unknown as GraphicComponents);
    none.created(newId<'Project'>());
    await none.settle();
    expect(none.designed).toHaveLength(1);
    expect(none.dispatched).toEqual([]);
    const outside = standIns(template, null);
    outside.created(null);
    await outside.settle();
    expect(outside.designed).toEqual([]);
  });

  it('records the design as running until it ends, so a make waits for it (FIX-GFXWAIT)', async () => {
    const template = templateOf(newId<'Template'>(), {
      text: [
        { id: newId<'TextOverlay'>(), design: BUBBLE },
        { id: newId<'TextOverlay'>(), design: BUBBLE },
      ],
    } as unknown as Template);
    const [first, second] = template.text.map((overlay) => overlay.id);
    const made = { uses: [{ overlayId: first, compositionId: composition.id }], compositions: [composition] };
    let open: () => void = () => {};
    const gate = new Promise<void>((resolve) => (open = resolve));
    const outcomes = [
      { role: 'question', overlays: [first], composition, matched: true, reason: null, rounds: 1 },
      {
        role: 'answer',
        overlays: [second],
        composition: null,
        matched: null,
        reason: 'the bounds check failed',
        rounds: 3,
      },
    ] as unknown as TemplateDesignOutcome[];
    const run = standIns(template, made as unknown as GraphicComponents, { outcomes, gate });
    run.created(newId<'Project'>());
    await run.settle();
    expect(run.tracker.running(template.id)).toBe(true);
    const waiting = run.tracker.wait(template.id, new AbortController().signal);
    open();
    expect(await waiting).toMatchObject({
      status: 'partly',
      designed: 1,
      total: 2,
      missing: [{ overlayId: second, reason: 'the bounds check failed' }],
    });
    expect(run.tracker.running(template.id)).toBe(false);
  });

  it('records nothing for a template with no graphics to design (FIX-GFXWAIT)', async () => {
    const plain = standIns(templateOf(newId<'Template'>(), { text: [] }), null);
    plain.created(newId<'Project'>());
    await plain.settle();
    expect(plain.designed).toEqual([]);
    expect(await plain.tracker.wait(newId<'Template'>(), new AbortController().signal)).toBeNull();
  });

  it('settles a design that could not run, naming every graphic as left without one (FIX-GFXWAIT)', async () => {
    const template = templateOf(newId<'Template'>());
    let open: () => void = () => {};
    const gate = new Promise<void>((resolve) => (open = resolve));
    const run = standIns(template, null, { gate });
    run.created(newId<'Project'>());
    await run.settle();
    const waiting = run.tracker.wait(template.id, new AbortController().signal);
    open();
    expect(await waiting).toMatchObject({
      status: 'failed',
      designed: 0,
      total: 1,
      missing: [{ overlayId: template.text[0]!.id, reason: 'the design could not run' }],
    });
    expect(run.dispatched).toEqual([]);
  });

  it('wants a design only with graphic overlays and no compositions yet', () => {
    const id = newId<'Template'>();
    expect(wantsDesign(templateOf(id))).toBe(true);
    expect(wantsDesign(templateOf(id, { text: [] }))).toBe(false);
    expect(
      wantsDesign(
        templateOf(id, { graphics: { uses: [], compositions: [composition] } } as unknown as Template),
      ),
    ).toBe(false);
    const faint = { ...BUBBLE, confidence: 0.1 };
    expect(wantsDesign(templateOf(id, { text: [{ design: faint }] } as unknown as Template))).toBe(false);
  });

  it('waits for the reel finalise keeps just after the template is created', async () => {
    const templateId = newId<'Template'>();
    let asked = 0;
    const later = {
      get: async () => {
        asked++;
        return ok(asked < 3 ? null : ({ path: '/kept/reel.mp4' } as never));
      },
    };
    expect(await keptReel(later, templateId, { tries: 5, everyMs: 1 })).toBe('/kept/reel.mp4');
    expect(asked).toBe(3);
    expect(await keptReel({ get: async () => ok(null) }, templateId, { tries: 2, everyMs: 1 })).toBeNull();
  });
});
