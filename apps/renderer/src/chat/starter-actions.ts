// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { I18n } from '@lingui/core';
import { callRpc, err, newId, ok, TEMPLATE_COMMANDS, type Result, type TemplateId } from '@taalcut/core';
import type { StarterChoice } from '@taalcut/ui';
import type { Backend } from '../backend/backend';
import { starterChoice } from '../features/starters/starter-words';
import { isAppLocale } from '../i18n/locales';

/**
 * P3-B3: forks a bundled starter into the person's templates under an id made here (`template.addStarter`, from
 * 'ui', one idempotency key per press), so the flow can start at it at once.
 */
export async function addStarterTemplate(
  backend: Backend,
  starterId: string,
): Promise<Result<{ readonly templateId: TemplateId }>> {
  const templateId = newId<'Template'>();
  const added = await callRpc(
    backend.commands.dispatch({
      name: TEMPLATE_COMMANDS.addStarter,
      payload: { projectId: null, starterId, templateId },
      source: 'ui',
      idempotencyKey: newId(),
    }),
  );
  return added.ok ? ok({ templateId }) : err(added.error);
}

/**
 * CardData.starters (P3-B3): the bundled starters for this language, best fit for the library first. The
 * pseudo-locale reads English's; a failed read throws, which the card shows as its error line.
 */
export async function loadStarters(backend: Backend, i18n: I18n): Promise<StarterChoice[]> {
  const locale = isAppLocale(i18n.locale) ? i18n.locale : 'en';
  const found = await callRpc(backend.templates.starters({ locale, forLibrary: true }));
  if (!found.ok) throw new Error(found.error.code);
  return found.value.map((summary) => starterChoice(i18n, summary));
}
