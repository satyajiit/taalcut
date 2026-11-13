// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: Kaatu sticker sheet · mode: Act (a press kit's downloads) · system: WEB2 Remix Vernacular
 * states: tile resting (the drawing on its white cut) · hover (the drawing hops 4 px and tilts: transform only) ·
 *   the PNG button: default · hover · focus (base ring) · active (2 % give) · loading (aria-busy, "Cutting", while the
 *   drawing is cut from its atlas) · success ("Saved", 2 s) · error (the atlas didn't load: "Try again") · reduced
 *   motion (no hop) · without JavaScript (the drawings show; the buttons, which need it, hide, and the full-size
 *   Kaatu below still downloads)
 * Kaatu's drawings from the site's 480 px atlases (components/kaatu/kaatu-frames.ts, served from /kaatu/), twelve on
 * a sheet, each with its name and a button that cuts that cell from its atlas into a 480 px PNG sticker in the browser
 * (canvas, the atlas's own pixels, never scaled up) and saves it as kaatu-<name>.png. */

import { Check, Download, LoaderCircle, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { KAATU_SHEETS, locate } from '#components/kaatu/kaatu-frames';
import { buttonClasses } from '#components/ui/button';
import { PRESS, type PressKaatu } from '#content/press';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';

type SaveState = 'idle' | 'busy' | 'saved' | 'failed';

/** The cell's place in its 3 × 3 atlas, as background positions (0, 50 or 100 %). */
function cellStyle(frame: PressKaatu['frame']) {
  const { sheet, cell } = locate(frame);
  return {
    backgroundImage: `url('${KAATU_SHEETS[sheet]}')`,
    backgroundSize: '300% 300%',
    backgroundPosition: `${(cell % 3) * 50}% ${Math.floor(cell / 3) * 50}%`,
  } as const;
}

function fileName(name: string): string {
  return `kaatu-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.png`;
}

/** Cuts one cell from its atlas into a PNG and hands it to the browser to save. */
async function savePng(frame: PressKaatu['frame'], name: string): Promise<void> {
  const { sheet, cell } = locate(frame);
  const img = new Image();
  img.decoding = 'async';
  img.src = KAATU_SHEETS[sheet]!;
  await img.decode();
  const side = Math.floor(img.naturalWidth / 3);
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas');
  ctx.drawImage(img, (cell % 3) * side, Math.floor(cell / 3) * side, side, side, 0, 0, side, side);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('No PNG');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName(name);
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function Tile({ item }: { readonly item: PressKaatu }) {
  const [state, setState] = useState<SaveState>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const save = async () => {
    window.clearTimeout(timer.current);
    setState('busy');
    try {
      await savePng(item.frame, item.name);
      setState('saved');
      timer.current = window.setTimeout(() => setState('idle'), 2000);
    } catch {
      setState('failed');
    }
  };
  const Icon = state === 'busy' ? LoaderCircle : state === 'saved' ? Check : state === 'failed' ? RotateCcw : Download;
  const words = state === 'busy' ? 'Cutting' : state === 'saved' ? 'Saved' : state === 'failed' ? 'Try again' : 'PNG';
  return (
    <li className="group flex flex-col items-center gap-3 rounded-reel bg-raised p-4 pb-5 shadow-sm">
      <span className="grid aspect-square w-full place-items-center">
        <span
          aria-hidden
          className="block size-full transition-transform duration-(--dur-short) ease-(--ease-out) group-hover:-translate-y-1 group-hover:-rotate-3 motion-reduce:transition-none motion-reduce:group-hover:transform-none"
          style={cellStyle(item.frame)}
        />
      </span>
      <span className="text-center type-label font-semibold text-ink">{item.name}</span>
      <button
        type="button"
        data-needs-js
        onClick={save}
        aria-busy={state === 'busy' || undefined}
        className={buttonClasses('secondary', 'md', cn('h-9 gap-1.5 px-3.5 type-label-sm', state === 'saved' ? 'text-teal-strong' : '', state === 'failed' ? 'text-rose-strong' : ''))}
      >
        <Icon aria-hidden strokeWidth={ICON_STROKE} className={cn('size-3.5', state === 'busy' ? 'animate-spin motion-reduce:animate-none' : '')} />
        {words}
        <span className="sr-only">: Kaatu, {item.name.toLowerCase()}</span>
      </button>
      <span role="status" className="sr-only">
        {state === 'saved' ? `Saved ${fileName(item.name)}` : state === 'failed' ? `Couldn’t cut Kaatu, ${item.name.toLowerCase()}. Try again.` : ''}
      </span>
    </li>
  );
}

export function KaatuSheet() {
  return (
    <>
      <noscript>
        <style>{'[data-needs-js]{display:none!important}'}</style>
      </noscript>
      <ul aria-label="Kaatu stickers" className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {PRESS.kaatu.map((item) => (
          <Tile key={item.frame} item={item} />
        ))}
      </ul>
    </>
  );
}
