// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `workspace.new`'s file (HFW1 "dsn"): a blank HyperFrames sub-composition that passes the gate, and nothing else.
 * It is structure only: the template, a root sized to the canvas with its id, size and length, no variables, an
 * empty style for the root, and one paused timeline with its `enter` and `exit` labels, registered once. There is no
 * shape, colour, word or motion in it: every design is the model's (the round's rule, plan "HFW1"). Its script says,
 * in comments, the one shape a tween may take (a call on `tl` with a selector and literal values at a label), so a
 * model edits the file instead of inventing code the gate refuses (eval:design: the 9B looped on `lower.scriptShape`
 * and `lower.target`). The shape has placeholders, not values: a 9B run copied an example's exact exit into its
 * designs, and every design's motion is the model's own. The comments run nothing.
 */

/** A composition's folder name, also its `data-composition-id`: lower case, digits and dashes, from a letter. */
export const COMPOSITION_NAME = /^[a-z][a-z0-9-]{0,39}$/;

export interface ScaffoldInput {
  /** The folder and the composition id (`COMPOSITION_NAME`). */
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** Seconds, 0.5 to 15. */
  readonly seconds: number;
}

/** Seconds as the scaffold writes them: at most two decimals, no trailing zeros. */
const secondsText = (seconds: number) => String(Math.round(seconds * 100) / 100);

/** Where the exit label sits: half a second before the end, or the middle of a short one. */
const exitAt = (seconds: number) => (seconds > 1 ? seconds - 0.5 : seconds / 2);

export function scaffoldHtml(input: ScaffoldInput): string {
  const { name, width, height, seconds } = input;
  if (!COMPOSITION_NAME.test(name)) throw new Error('Not a composition name');
  return `<!doctype html>
<html lang="en" data-composition-variables='[]'>
  <head>
    <meta charset="UTF-8" />
  </head>
  <body>
    <template id="${name}-template">
      <style>
        #root {
          position: absolute;
          inset: 0;
        }
      </style>
      <div id="root" data-composition-id="${name}" data-width="${width}" data-height="${height}" data-duration="${secondsText(seconds)}"></div>
      <script>
        const tl = gsap.timeline({ paused: true });
        tl.addLabel('enter', 0);
        // Each tween is one call on tl: a selector of an element inside #root, literal values, a label or a second.
        // The shape, to fill with your own selectors, properties, values and eases:
        //   tl.from('<selector>', { <property>: <value>, duration: <seconds>, ease: '<ease>' }, 'enter');
        //   tl.to('<selector>', { <property>: <value>, duration: <seconds>, ease: '<ease>' }, 'exit');
        // Nothing else runs here: no variables, loops, functions, document queries or gsap.set.
        tl.addLabel('exit', ${secondsText(exitAt(seconds))});
        window.__timelines['${name}'] = tl;
      </script>
    </template>
  </body>
</html>
`;
}

/** The scaffold's path in the workspace. */
export const scaffoldPath = (name: string) => `${name}/index.html`;
