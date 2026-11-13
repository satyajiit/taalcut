// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The export's browser has no route off the machine (HFW1, defence in depth behind the composition gate): the
 * engine patch launches every browser with every name resolving to nothing and a closed proxy for the rest, while
 * the producer's own file server on loopback stays reachable. A test-only page (it skips the gate on purpose) tries
 * an external fetch, an external image and a raw-IP image; each paints its square green when it fails and red when
 * it loads. The export finishes, and every square is green.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FrameRate } from '@taalcut/core';
import { runProducer } from '../../src/engine/producer';
import { findTestMedia, mediaContext, patchColours, tempDir } from '../support/media';
import { findTestShell } from '../support/shell';
import { writeMotionBundle } from '../motion/page-support';
import { stillTimeline } from '../workspace/support';

const media = await findTestMedia('export offline');
const shell = findTestShell('export offline');

const SQUARES = { fetch: 100, image: 420, address: 740 } as const;

const PROBE = `
<div id="t-fetch" class="t-probe" style="left:${SQUARES.fetch}px"></div>
<div id="t-image" class="t-probe" style="left:${SQUARES.image}px"></div>
<div id="t-address" class="t-probe" style="left:${SQUARES.address}px"></div>
<style>.t-probe { position: fixed; top: 100px; width: 200px; height: 200px; background: #808080; z-index: 99999; }</style>
<script>
(function () {
  function mark(id, reached) { document.getElementById('t-' + id).style.background = reached ? '#ff0000' : '#00ff00'; }
  fetch('https://example.com/made-up.json').then(function () { mark('fetch', true); }, function () { mark('fetch', false); });
  var image = new Image();
  image.onload = function () { mark('image', true); };
  image.onerror = function () { mark('image', false); };
  image.src = 'https://example.com/made-up.png';
  var address = new Image();
  address.onload = function () { mark('address', true); };
  address.onerror = function () { mark('address', false); };
  address.src = 'http://93.184.216.34/made-up.png';
})();
</script>
`;

describe.skipIf(!media.binaries || !shell.path)('the export’s browser, offline', { timeout: 600_000 }, () => {
  let work: Awaited<ReturnType<typeof tempDir>>;
  beforeAll(async () => {
    work = await tempDir('export-offline');
  });
  afterAll(async () => {
    await work?.dispose();
  });

  it('finishes the export while an external fetch, image and raw-IP image each fail', async () => {
    const dir = join(work.dir, 'bundle');
    await writeMotionBundle(stillTimeline(30), dir, 'export', { burnCaptions: false });
    const index = join(dir, 'index.html');
    await writeFile(index, (await readFile(index, 'utf8')).replace('</body>', `${PROBE}</body>`));
    const out = join(work.dir, 'out.mov');
    const ctx = mediaContext(media.binaries!);
    const run = await runProducer({
      dir,
      out,
      rate: FrameRate.of(30),
      bitrateKbps: 8000,
      chromePath: shell.path!,
      browserGpu: 'software',
      gpuEncode: false,
      workers: 1,
      binaries: ctx.binaries,
    });
    if (!run.ok) throw new Error(`${run.error.code}: ${run.error.detail ?? ''}`);
    for (const left of Object.values(SQUARES)) {
      const colours = await patchColours(ctx, out, { x: left + 92, y: 192, size: 16 });
      const [r, g, b] = colours.at(-1) ?? [0, 0, 0];
      // Green: the request failed. Red would be a request that reached the network; grey, one never answered.
      expect([r, g, b].map((value) => Math.round(value / 64))).toEqual([0, 4, 0]);
    }
  });
});
