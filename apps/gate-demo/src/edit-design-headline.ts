// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-UI: the made-up composition the stand-in model writes for "a newspaper-style headline" (edit-design-script.ts):
 * a HyperFrames sub-composition, as a designing model would write one, that passes render's gate (bundled fonts,
 * the allowed markup and CSS, one paused timeline with its enter and exit labels). It is a test fixture: it exists
 * only in this stand-in's replies and its recorded session, and nothing in the app ships or falls back to it.
 */

/** The composition's folder and id. */
export const EDIT_DESIGN_FOLDER = 'headline';
export const EDIT_DESIGN_ENTRY = `${EDIT_DESIGN_FOLDER}/index.html`;

export const EDIT_DESIGN_HTML = `<!doctype html>
<html
  lang="en"
  data-composition-variables='[{"id":"kicker","type":"string","label":"Kicker","default":"Morning edition"},{"id":"headline","type":"string","label":"Headline","default":"Market opens at dawn"},{"id":"ink","type":"color","label":"Ink","default":"#1d1d1f"}]'
>
  <head>
    <meta charset="UTF-8" />
  </head>
  <body>
    <template id="headline-template">
      <style>
        #root {
          position: absolute;
          inset: 0;
        }
        #paper {
          position: absolute;
          left: 80px;
          top: 300px;
          width: 920px;
          padding: 36px 44px 40px;
          border-radius: 6px;
          background: #f4efe4;
        }
        #kicker {
          margin: 0 0 14px;
          font-family: 'Montserrat', sans-serif;
          font-size: 34px;
          font-weight: 700;
          letter-spacing: 4px;
          color: var(--ink);
        }
        #headline {
          margin: 0;
          font-family: 'Anton', sans-serif;
          font-size: 96px;
          line-height: 1.05;
          color: var(--ink);
          text-wrap: balance;
        }
      </style>
      <div id="root" data-composition-id="headline" data-width="1080" data-height="1920" data-duration="3.5">
        <div id="paper">
          <p id="kicker" data-var-text="kicker">Morning edition</p>
          <p id="headline" data-var-text="headline">Market opens at dawn</p>
        </div>
      </div>
      <script>
        const tl = gsap.timeline({ paused: true });
        tl.addLabel('enter', 0);
        tl.from('#paper', { y: -80, opacity: 0, duration: 0.5, ease: 'power3.out' }, 0);
        tl.from('#headline', { y: 24, opacity: 0, duration: 0.4, ease: 'power2.out' }, 0.2);
        tl.addLabel('exit', 3);
        tl.to('#paper', { y: -40, opacity: 0, duration: 0.3, ease: 'power2.in' }, 'exit');
        window.__timelines['headline'] = tl;
      </script>
    </template>
  </body>
</html>
`;
