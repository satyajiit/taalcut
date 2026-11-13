// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* global document, window, gsap */

/**
 * Builds the loop's parts and its one paused timeline. Nothing here reads a clock or a random number: the picture at
 * any time depends on that time alone, which is what lets HyperFrames seek it frame by frame.
 */
const still = (name) => `url('assets/${name}.jpg')`;
const make = (parent, tag = 'div') =>
  document.getElementById(parent).appendChild(document.createElement(tag));

/** The 13 clips the AI picks, slot by slot, and the one the person swaps in for slot 4. */
const PICKS = [
  'roll-vietnam-02', 'roll-repeat-05', 'roll-vietnam-09', 'roll-repeat-04', 'roll-vietnam-13', 'roll-repeat-13',
  'roll-vietnam-05', 'roll-repeat-06', 'roll-vietnam-12', 'roll-repeat-08', 'roll-vietnam-04', 'roll-repeat-09',
  'roll-vietnam-10',
]; // prettier-ignore
const SWAP = { slot: 3, clip: 'roll-repeat-15' };
/** Where each pick sits in the camera roll's two rows of seven; the fourteenth cell holds the swap. */
const CELL_OF_PICK = [1, 6, 11, 3, 8, 0, 13, 5, 10, 2, 7, 12, 4];
/** Slot lengths in beats, as the strip draws them: 32 across 1,100 px with 6 px between slots. */
const BEATS = [3, 2, 2, 2, 3, 2, 2, 3, 2, 3, 2, 2, 4];
const [STRIP_X, STRIP_Y, STRIP_W, GAP] = [90, 606, 1100, 6];
const UNIT = (STRIP_W - GAP * (BEATS.length - 1)) / 32;
const [ROLL_X, ROLL_Y, CELL_W, CELL_H] = [330, 246, 112, 150];
const CELL_GAP = (860 - CELL_W * 7) / 6;

const slots = [];
let offset = 0;
for (const [index, beats] of BEATS.entries()) {
  const box = make('slots');
  const width = beats * UNIT;
  Object.assign(box.style, { left: `${offset}px`, width: `${width}px` });
  const fill = box.appendChild(document.createElement('span'));
  fill.style.backgroundImage = still(PICKS[index]);
  const edge = box.appendChild(document.createElement('i'));
  slots.push({ box, fill, edge, left: offset, width });
  offset += width + GAP;
}
for (let tick = 0; tick < 22; tick += 1) make('ticks').style.left = `${(tick * (STRIP_W - 3)) / 21}px`;

const cells = [];
for (let cell = 0; cell < 14; cell += 1) {
  const box = make('cells');
  const pick = CELL_OF_PICK.indexOf(cell);
  const left = (cell % 7) * (CELL_W + CELL_GAP);
  const top = Math.floor(cell / 7) * (CELL_H + 12);
  Object.assign(box.style, {
    left: `${left}px`,
    top: `${top}px`,
    backgroundImage: still(pick < 0 ? SWAP.clip : PICKS[pick]),
  });
  cells.push({ box, left: ROLL_X + left, top: ROLL_Y + top });
}

const frames = (parent, names) =>
  names.map((name) => {
    const frame = make(parent);
    frame.style.backgroundImage = still(name);
    return frame;
  });
const reelFrames = frames(
  'reel-frames',
  Array.from({ length: 12 }, (_, index) => `reel-vietnam-${String(index + 1).padStart(2, '0')}`),
);
const versionFrames = frames('version-frames', [...PICKS, SWAP.clip]);

const flyers = PICKS.map((name, index) => {
  const flyer = make('flyers');
  const from = cells[CELL_OF_PICK[index]];
  flyer.style.backgroundImage = still(name);
  gsap.set(flyer, { x: from.left, y: from.top, width: CELL_W, height: CELL_H, opacity: 0 });
  return flyer;
});

// Where everything starts.
gsap.set(
  ['#words-2', '#words-3', '#roll', '#version', '#pick-tag', '#yours-tag', '#approve-done', '#playhead'],
  { opacity: 0 },
);
gsap.set(['.stat', '.check', '#approve'], { opacity: 0, y: 14 });
gsap.set(slots.map((slot) => slot.box), { opacity: 0, scale: 0.7 }); // prettier-ignore
gsap.set(slots.map((slot) => [slot.fill, slot.edge]).flat(), { opacity: 0 }); // prettier-ignore
gsap.set('#ticks div', { opacity: 0 });
gsap.set([...reelFrames.slice(1), ...versionFrames.slice(1)], { opacity: 0 });
gsap.set('#cells div', { opacity: 0, scale: 0.85 });

const tl = gsap.timeline({ paused: true });
const on = { borderColor: '#211a13', backgroundColor: '#ffb331', color: '#211a13' };
const off = { borderColor: '#e5dccd', backgroundColor: '#fffdf9', color: '#6f6457' };
const step = (pill, at) => {
  tl.to(`.pill:not(${pill})`, { ...off, duration: 0.2 }, at).to(pill, { ...on, duration: 0.2 }, at);
};
// The first frame is the picture a paused GIF shows, so step 1 is already lit in it.
gsap.set('#pill-1', on);
const show = (frame, list, at) => tl.set(list, { opacity: 0 }, at).set(list[frame], { opacity: 1 }, at);

// 1. Paste: the scan reads the reel, a slot appears for every cut, the ticks for its beats.
tl.fromTo('#scan', { y: 0 }, { y: 300, duration: 1.1, ease: 'sine.inOut', repeat: 1, yoyo: true }, 0.3);
slots.forEach((slot, index) => {
  const at = 0.45 + index * 0.16;
  if (index > 0) show(index % 12, reelFrames, at);
  tl.to(slot.box, { opacity: 1, scale: 1, duration: 0.22, ease: 'back.out(2)' }, at);
});
tl.to('#ticks div', { opacity: 0.6, duration: 0.15, stagger: 0.04 }, 0.9);
tl.to('#stat-cuts', { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' }, 0.5);
tl.to('#stat-beats', { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' }, 0.9);
tl.to('#stat-slots', { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' }, 1.3);
tl.to('#scan', { opacity: 0, duration: 0.2 }, 2.5);

// 2. Pick: the camera roll comes in and each slot takes its clip.
step('#pill-2', 2.9);
tl.to(['#words-1', '#reads'], { opacity: 0, duration: 0.2 }, 2.8);
tl.to(['#words-2', '#roll'], { opacity: 1, duration: 0.25 }, 2.95);
tl.to('#cells div', { opacity: 1, scale: 1, duration: 0.25, stagger: 0.02, ease: 'power2.out' }, 2.95);
tl.to('#pick-tag', { opacity: 1, duration: 0.2 }, 3.4).to('#pick-tag', { opacity: 0, duration: 0.2 }, 4.7);
flyers.forEach((flyer, index) => {
  const at = 3.4 + index * 0.17;
  const slot = slots[index];
  tl.set(flyer, { opacity: 1 }, at);
  tl.to(
    flyer,
    {
      x: STRIP_X + slot.left,
      y: STRIP_Y,
      width: slot.width,
      height: 62,
      duration: 0.36,
      ease: 'power2.inOut',
    },
    at,
  );
  tl.set([slot.fill, slot.edge], { opacity: 1 }, at + 0.36).set(flyer, { opacity: 0 }, at + 0.38);
  tl.set(slot.box, { borderColor: 'transparent' }, at + 0.36);
});

// 3. Approve: both phones play the same rhythm, one shot is swapped by hand, one button ends it.
step('#pill-3', 6);
tl.to(['#words-2', '#roll'], { opacity: 0, duration: 0.2 }, 5.9);
tl.to(['#words-3', '#version', '#playhead'], { opacity: 1, duration: 0.25 }, 6.05);
tl.to('#check-1', { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' }, 6.15);
tl.to('#check-2', { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' }, 6.4);
tl.to('#approve', { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' }, 6.65);
const [PLAY_FROM, PLAY_FOR] = [6.45, 1.5];
tl.fromTo('#playhead', { x: 0 }, { x: STRIP_W, duration: PLAY_FOR, ease: 'none' }, PLAY_FROM);
slots.forEach((slot, index) => {
  const at = PLAY_FROM + (slot.left / STRIP_W) * PLAY_FOR;
  show(index % 12, reelFrames, at);
  show(index === SWAP.slot ? PICKS.length : index, versionFrames, at);
  tl.to(slot.box, { y: -7, duration: 0.09, yoyo: true, repeat: 1, ease: 'power1.out' }, at);
  tl.to('#kaatu', { y: -7, rotation: index % 2 ? 4 : -4, duration: 0.09, yoyo: true, repeat: 1 }, at);
});
// The swap lands before the playhead reaches slot 4, so the person's clip is the one that plays.
const swapped = slots[SWAP.slot];
tl.set(swapped.fill, { backgroundImage: still(SWAP.clip) }, 6.3);
tl.set(swapped.edge, { backgroundColor: '#056965' }, 6.3);
tl.fromTo(swapped.box, { scale: 1 }, { scale: 1.12, duration: 0.14, yoyo: true, repeat: 1 }, 6.3);
tl.to('#yours-tag', { opacity: 1, duration: 0.2 }, 6.3);
// "Approved" holds for the last two seconds: long enough to read before the loop starts over.
tl.to('#approve', { scale: 0.94, duration: 0.08, yoyo: true, repeat: 1 }, 7.84);
tl.set('#approve-ask', { opacity: 0 }, 8).set('#approve-done', { opacity: 1 }, 8);
tl.set('#approve', { backgroundColor: '#056965', color: '#fffdf9' }, 8);
window.__timelines['how-it-works'] = tl;
