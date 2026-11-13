// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { flowHarness } from '../support/flow-harness';
import { flowScript } from '../support/flow-script';
import { ofType } from '../support/harness';

describe('a reference copy with footage directions', () => {
  it.each(['reference', 'template'] as const)(
    '%s reaches export approval with a supplemental brief',
    async (path) => {
      const brief = { text: 'Use our airport, plane and related travel shots.' };
      const templateId = newId<'Template'>();
      const h = flowHarness({
        script: (request, turn) =>
          flowScript({
            ask: false,
            startFlow: {
              path,
              ...(path === 'reference'
                ? { reference: { kind: 'link', url: 'https://www.instagram.com/reel/airport/' } }
                : { templateId }),
              brief,
            },
          })(request, turn),
      });
      if (path === 'template') h.world.templates.set(templateId, 1);
      const outcome = unwrap(
        await h.agent.run({
          conversationId: 'airport',
          projectId: h.world.projectId,
          message: `Create from this reel. ${brief.text}`,
        }),
      );
      expect(outcome.status).toBe('paused');
      const events = await h.events(outcome.runId);
      expect(ofType(events, 'run.failed')).toEqual([]);
      expect(ofType(events, 'flow.started')[0]?.payload.input).toEqual({ brief });
      const librarian = ofType(events, 'skill.entered').find(
        (event) => event.payload.skill === 'timeline.librarian',
      );
      expect(librarian?.payload.input).toMatchObject({
        projectId: h.world.projectId,
        templateId: expect.any(String),
      });
      expect(librarian?.payload.input).not.toHaveProperty('brief');
      expect(ofType(events, 'card.sent').at(-1)?.payload.card.type).toBe('exportApproval');
      const casting = h.models.requests.find((request) =>
        request.system?.includes('# Skill: timeline.librarian'),
      );
      expect(JSON.stringify(casting?.messages)).toContain(brief.text);
    },
  );
});
