// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * workspace.lint's fix for the first error (HFW1 dsn), through the real gate, on the kinds of script eval:design's
 * 9B kept writing: a position worked out with `if`, words read from `window.__variables`, `CustomEase.create`,
 * tweens built in a `forEach`, a tween of a class the markup doesn't have. Each gets its exact line and why; a
 * design that passes gets none.
 */
import { describe, expect, it } from 'vitest';
import { spokenTimeline } from '../../compositions/support';
import { workspaceWorld } from './support';

const page = (script: string) => `<!doctype html>
<html lang="en" data-composition-variables='[]'>
  <head>
    <meta charset="UTF-8" />
  </head>
  <body>
    <template id="card-template">
      <style>
        #root { position: absolute; inset: 0; }
        .card { position: absolute; left: 120px; top: 400px; font-size: 64px; color: #ffffff; }
      </style>
      <div id="root" data-composition-id="card" data-width="1080" data-height="1920" data-duration="3">
        <div class="card">made-up words</div>
      </div>
      <script>
        const tl = gsap.timeline({ paused: true });
        tl.addLabel('enter', 0);
${script}
        tl.addLabel('exit', 2.5);
        window.__timelines['card'] = tl;
      </script>
    </template>
  </body>
</html>
`;

async function lintOf(script: string) {
  const world = workspaceWorld(spokenTimeline([[10, 60, 'made-up words']]));
  const { projectId } = world;
  const wrote = await world.call('workspace.write', { projectId, path: 'card/index.html', text: page(script) });
  if (!wrote.ok) throw new Error(wrote.error.code);
  const lint = await world.call('workspace.lint', { projectId, entry: 'card/index.html' });
  if (!lint.ok) throw new Error(lint.error.code);
  return lint.value as { passed: boolean; fix?: { line: number; now: string; write?: string | null; why: string } };
}

const TWEEN = "        tl.from('.card', { opacity: 0, duration: 0.4 }, 'enter');";

describe('workspace.lint’s fix for the first error', () => {
  it.each([
    ['a position worked out with if', "        const width = 1080 - 120;\n        if (width > 900) { tl.set('.card', { x: 10 }); }", 'if (width > 900)', 'work any number out yourself'],
    ['words read in the script', "        const text = window.__variables.text || 'x';", 'const text = window.__variables', 'variables in the markup'],
    ['a custom ease', '        CustomEase.create("snap", "M0,0 C0.3,1 0.6,1 1,1");', 'CustomEase.create', 'named string'],
    ['tweens built in a loop', "        ['.card'].forEach((el, i) => tl.from(el, { opacity: 0, duration: 0.4 }, i * 0.1));", "['.card'].forEach", 'stagger'],
  ])('deletes %s, by its line, and says why', async (_, script, now, why) => {
    const lint = await lintOf(`${script}\n${TWEEN}`);
    expect(lint.passed).toBe(false);
    expect(lint.fix).toMatchObject({ write: null });
    expect(lint.fix?.now.startsWith(now)).toBe(true);
    expect(lint.fix?.why).toContain(why);
    // The line number is the file's: the line it names holds that text.
    expect(page(`${script}\n${TWEEN}`).split('\n')[lint.fix!.line - 1]?.trim()).toBe(lint.fix?.now);
  });

  it('names the elements the template has when a tween targets a class it doesn’t', async () => {
    const lint = await lintOf("        const bubble = document.querySelector('.bubble');\n        tl.from(bubble, { opacity: 0, duration: 0.4 }, 'enter');");
    expect(lint.fix).toMatchObject({ now: "const bubble = document.querySelector('.bubble');" });
    expect(lint.fix?.write).toBeUndefined();
    expect(lint.fix?.why).toContain('it has .card');
  });

  it('asks for a class of its own for a selector the motion can’t follow, and takes descendants and children', async () => {
    const lint = await lintOf("        tl.from('.card:hover', { opacity: 0, duration: 0.4 }, 'enter');");
    expect(lint.fix).toMatchObject({ now: "tl.from('.card:hover', { opacity: 0, duration: 0.4 }, 'enter');" });
    expect(lint.fix?.why).toContain('no pseudo-classes but :first-child');
    for (const selector of ['#root .card', '#root > .card', '.card:first-child'])
      expect(await lintOf(`        tl.from('${selector}', { opacity: 0, duration: 0.4 }, 'enter');`)).toMatchObject({ passed: true });
  });

  it('gives none to a design that passes', async () => {
    const lint = await lintOf(TWEEN);
    expect(lint).toMatchObject({ passed: true });
    expect(lint.fix).toBeUndefined();
  });
});
