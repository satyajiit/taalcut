// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The bundled starters (P3-B3, P3-L2) as file name → text: starters/manifest.json and one Hub template v0 per
 * catalogue row. Pure and deterministic (ids from one counter), so `starters:build` writes these bytes and
 * test/starters/starter-files.test.ts checks the committed files still match. Festival vlog gains a `{time}`
 * label on the plan; the hub file keeps the role placeholder (`{label}`) and the character count, not the token.
 */
import { hubContentProblems, parseId, templateSchema, type Id, type Template } from '@taalcut/core';
import { FORMAT_BPM, planFormat, type TemplateIds } from '../src/formats/plan-format';
import { toHubTemplate } from '../src/hub/to-hub';
import { stableTemplateJson } from '../src/library/template-file';
import { STARTER_CATALOGUE, starterCardLanguage, type StarterSpec } from '../src/starters/catalogue';
import { starterManifestSchema } from '../src/starters/manifest-schema';

/** Fixed ULIDs from one counter, so two builds write the same bytes. */
function counter() {
  const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let n = 0;
  return <Entity extends string>(): Id<Entity> => {
    let value = n++;
    let tail = '';
    for (let i = 0; i < 8; i += 1, value = Math.floor(value / 32)) {
      tail = (crockford[value % 32] ?? '0') + tail;
    }
    const id = parseId<Entity>(`01HZZZZZZZZZZZZZZZ${tail}`);
    if (!id.ok) throw new Error(`starter id ${id.error.code}`);
    return id.value;
  };
}

function festivalTime(template: Template, ids: TemplateIds): Template {
  const host = template.slots.find((slot) => slot.role === 'body');
  if (!host) throw new Error('festival-vlog has no body slot');
  return {
    ...template,
    text: [
      ...template.text,
      {
        id: ids.overlay(),
        text: '{time}',
        role: 'label',
        start: host.start,
        duration: host.duration,
        slotId: host.id,
        box: { x: 0.13, y: 0.28, width: 0.4, height: 0.05 },
        appearance: { size: 0.03, align: 'left', case: 'mixed', background: 'none' },
        styleKey: 'label',
        reveal: 'fade',
        language: null,
        confidence: 1,
      },
    ],
  };
}

function plan(row: StarterSpec, ids: TemplateIds): Template {
  const planned = planFormat(
    {
      formatId: row.formatId,
      targetSeconds: row.seconds,
      bpm: row.bpm ?? FORMAT_BPM.default,
      createdAt: 5,
    },
    ids,
  );
  if (!planned.ok) throw new Error(`${row.id}: ${planned.error.detail ?? planned.error.code}`);
  const template = row.id === 'festival-vlog' ? festivalTime(planned.value, ids) : planned.value;
  const checked = templateSchema.safeParse(template);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    throw new Error(`${row.id}: ${issue?.path.join('.') ?? ''} ${issue?.message ?? 'invalid plan'}`);
  }
  return checked.data;
}

/** Every starter file, manifest last. Throws on a plan, document or manifest that would not ship. */
export function starterFiles(): Map<string, string> {
  const next = counter();
  const ids: TemplateIds = {
    template: () => next<'Template'>(),
    slot: () => next<'TemplateSlot'>(),
    overlay: () => next<'TextOverlay'>(),
  };
  const files = new Map<string, string>();
  const manifest = STARTER_CATALOGUE.map((row, order) => {
    const template = plan(row, ids);
    const hubId = next<'HubTemplate'>();
    const doc = toHubTemplate(
      template,
      { name: row.id, hubId, version: 1, provenance: null },
      {
        name: row.id,
        description: '',
        handle: 'taalcut',
        tags: [],
        language: starterCardLanguage(row.locales),
        includeStyle: false,
      },
      null,
    );
    if (!doc.ok) throw new Error(`${row.id}: ${doc.error.detail ?? doc.error.code}`);
    const problems = hubContentProblems(doc.value);
    if (problems.length > 0) throw new Error(`${row.id}: ${JSON.stringify(problems)}`);
    const file = `${row.id}.json`;
    files.set(file, stableTemplateJson(doc.value));
    return {
      id: row.id,
      file,
      formatId: row.formatId,
      locales: row.locales === 'all' ? 'all' : [...row.locales],
      nameKey: `starters.${row.id}.name`,
      descriptionKey: `starters.${row.id}.description`,
      order,
      needs: row.needs,
    };
  });
  const parsed = starterManifestSchema.safeParse(manifest);
  if (!parsed.success) throw new Error(parsed.error.message);
  files.set('manifest.json', stableTemplateJson(parsed.data));
  return files;
}

const camel = (file: string) =>
  file.replace(/\.json$/u, '').replace(/-([a-z0-9])/gu, (_, char: string) => char.toUpperCase());

/**
 * src/starters/bundled-documents.ts: every starter document as a JSON import, so the bundler puts them in the
 * agent's code and the packaged app (which has no package directory to read) still has them.
 */
export function bundledStartersModule(files: readonly string[]): string {
  const documents = files.filter((file) => file !== 'manifest.json').sort();
  const imports = documents.map(
    (file) => `import ${camel(file)} from '../../starters/${file}' with { type: 'json' };`,
  );
  const entries = documents.map((file) => `  ['${file}', ${camel(file)}],`);
  return [
    '// SPDX-License-Identifier: AGPL-3.0-or-later',
    '// Copyright (C) 2026 Taalcut contributors',
    '',
    '/** Generated by `starters:build` (scripts/starter-files.ts): the bundled starter documents by file name. */',
    ...imports,
    '',
    'export const BUNDLED_STARTERS: ReadonlyMap<string, unknown> = new Map<string, unknown>([',
    ...entries,
    ']);',
    '',
  ].join('\n');
}
