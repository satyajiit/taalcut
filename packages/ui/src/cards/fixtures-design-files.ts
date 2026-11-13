// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-UI: the made-up workspace files behind the design fixtures (fixtures-designs.ts), for /dev/kit, the fake's
 * files viewer and the tests. They are sample text for a read-only code view: nothing draws them, nothing ships
 * them as a design, and the app never makes a graphic from them. Each file's sha256 is a made-up one.
 */

const hex = (pair: string) => pair.repeat(32);

/** Made-up sha256s, one per file. */
export const DESIGN_FILE_SHAS = {
  bubbleHtml: hex('b1'),
  bubbleCss: hex('b2'),
  bubbleCssV2: hex('b3'),
  priceHtml: hex('c1'),
  priceCss: hex('c2'),
  headlineHtml: hex('d1'),
  headlineCss: hex('d2'),
  grain: hex('e1'),
} as const;

const BUBBLE_HTML = `<div class="clip bubble" data-composition-id="chat-bubble"
  data-width="1080" data-height="1920" data-duration="3"
  data-composition-variables='[
    {"name": "message", "type": "text"},
    {"name": "side", "type": "enum"},
    {"name": "fill", "type": "colour"},
    {"name": "ticks", "type": "boolean"}
  ]'>
  <p class="bubble__text" data-text="message">Are you at the market?</p>
  <span class="bubble__ticks" data-if="ticks" aria-hidden="true">✓✓</span>
</div>
<script>
  const tl = gsap.timeline({ paused: true });
  tl.addLabel('enter', 0)
    .from('.bubble', { y: 48, scale: 0.92, opacity: 0, duration: 0.35, ease: 'back.out(1.6)' })
    .from('.bubble__ticks', { opacity: 0, duration: 0.2 }, 0.3)
    .addLabel('exit', 2.6)
    .to('.bubble', { opacity: 0, y: -16, duration: 0.3, ease: 'power2.in' }, 'exit');
  window.__timelines = { 'chat-bubble': tl };
</script>
`;

const BUBBLE_CSS = `.bubble {
  position: absolute;
  top: 22%;
  left: 8%;
  width: fit-content;
  max-width: 70%;
  padding: 28px 36px;
  border-radius: 40px;
  background: var(--fill);
  color: #ffffff;
  font: 600 44px/1.25 var(--font-caption);
  text-wrap: balance;
}

.bubble[data-side='right'] {
  left: auto;
  right: 8%;
}

.bubble__ticks {
  margin-inline-start: 12px;
  opacity: 0.8;
}
`;

const BUBBLE_CSS_V2 = `.bubble {
  position: absolute;
  top: 22%;
  left: 8%;
  width: fit-content;
  max-width: 68%;
  padding: 26px 34px 30px;
  border-radius: 44px 44px 44px 12px;
  background: var(--fill);
  box-shadow: 0 10px 30px rgb(0 0 0 / 0.25);
  color: #ffffff;
  font: 600 44px/1.25 var(--font-caption);
  text-wrap: balance;
}

.bubble[data-side='right'] {
  left: auto;
  right: 8%;
  border-radius: 44px 44px 12px 44px;
}

.bubble__ticks {
  margin-inline-start: 12px;
  color: #9be7ff;
}
`;

const PRICE_HTML = `<div class="clip tag" data-composition-id="price-tag"
  data-width="1080" data-height="1920" data-duration="2.5"
  data-composition-variables='[
    {"name": "item", "type": "text"},
    {"name": "price", "type": "text"},
    {"name": "accent", "type": "colour"}
  ]'>
  <span class="tag__item" data-text="item">Mangoes</span>
  <strong class="tag__price" data-text="price">₹120 a dozen</strong>
</div>
<script>
  const tl = gsap.timeline({ paused: true });
  tl.addLabel('enter', 0)
    .from('.tag', { rotation: -8, scale: 0.6, opacity: 0, duration: 0.4, ease: 'back.out(2)' })
    .from('.tag__price', { y: 20, opacity: 0, duration: 0.25 }, 0.25)
    .addLabel('exit', 2.1)
    .to('.tag', { scale: 0.8, opacity: 0, duration: 0.3 }, 'exit');
  window.__timelines = { 'price-tag': tl };
</script>
`;

const PRICE_CSS = `.tag {
  position: absolute;
  bottom: 24%;
  right: 10%;
  display: grid;
  gap: 6px;
  padding: 24px 32px;
  border-radius: 20px;
  background: #fffaf0;
  border: 6px solid var(--accent);
  color: #1d1d1f;
  font-family: var(--font-caption);
  transform-origin: top right;
}

.tag__item {
  font-size: 34px;
  font-weight: 500;
}

.tag__price {
  font-size: 52px;
  font-weight: 800;
  color: var(--accent);
}
`;

const HEADLINE_HTML = `<div class="clip paper" data-composition-id="headline"
  data-width="1080" data-height="1920" data-duration="3.5"
  data-composition-variables='[
    {"name": "headline", "type": "text"},
    {"name": "kicker", "type": "text"},
    {"name": "ink", "type": "colour"}
  ]'>
  <p class="paper__kicker" data-text="kicker">Morning edition</p>
  <h1 class="paper__headline" data-text="headline">Market opens at dawn</h1>
  <svg class="paper__rule" viewBox="0 0 800 8" aria-hidden="true">
    <path d="M0 4 H800" />
  </svg>
</div>
<script>
  const tl = gsap.timeline({ paused: true });
  const words = SplitText.create('.paper__headline', { type: 'words' });
  tl.addLabel('enter', 0)
    .from('.paper', { yPercent: 12, opacity: 0, duration: 0.4, ease: 'power3.out' })
    .from(words.words, { y: 30, opacity: 0, duration: 0.35, stagger: 0.06 }, 0.2)
    .from('.paper__rule path', { drawSVG: '0%', duration: 0.5, ease: 'power2.inOut' }, 0.5)
    .addLabel('exit', 3.1)
    .to('.paper', { opacity: 0, duration: 0.3 }, 'exit');
  window.__timelines = { headline: tl };
</script>
`;

const HEADLINE_CSS = `.paper {
  position: absolute;
  top: 12%;
  left: 7%;
  right: 7%;
  padding: 36px 44px 40px;
  background: url(assets/${DESIGN_FILE_SHAS.grain}) #f4efe6;
  color: var(--ink);
  font-family: var(--font-caption);
}

.paper__kicker {
  margin: 0 0 12px;
  font-size: 30px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.paper__headline {
  margin: 0;
  font-size: 84px;
  line-height: 1.02;
  font-weight: 800;
  text-wrap: balance;
}

.paper__rule {
  width: 100%;
  height: 8px;
  margin-top: 20px;
  stroke: var(--ink);
  stroke-width: 8;
}
`;

/** Each file's text by its sha256; the grain is an image, so it has none. */
export const DESIGN_FILE_TEXT: Readonly<Record<string, string | null>> = {
  [DESIGN_FILE_SHAS.bubbleHtml]: BUBBLE_HTML,
  [DESIGN_FILE_SHAS.bubbleCss]: BUBBLE_CSS,
  [DESIGN_FILE_SHAS.bubbleCssV2]: BUBBLE_CSS_V2,
  [DESIGN_FILE_SHAS.priceHtml]: PRICE_HTML,
  [DESIGN_FILE_SHAS.priceCss]: PRICE_CSS,
  [DESIGN_FILE_SHAS.headlineHtml]: HEADLINE_HTML,
  [DESIGN_FILE_SHAS.headlineCss]: HEADLINE_CSS,
  [DESIGN_FILE_SHAS.grain]: null,
};

const bytes = (sha256: string) => new TextEncoder().encode(DESIGN_FILE_TEXT[sha256] ?? '').byteLength || 2048;

/** A workspace file record: its path, its sha256 and how many bytes it is. */
export const designFile = (path: string, sha256: string) => ({ path, sha256, bytes: bytes(sha256) });
