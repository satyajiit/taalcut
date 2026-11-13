// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Rules the JSON Schema cannot state: slots tile the duration, times that belong to the
 * canvas are whole frames at the canvas rate, anchors land within a frame, shotCount
 * matches the slots, and overlays stay inside the duration. Beat-map beats keep beatMap.rate.
 */
export function structureProblems(doc) {
  const problems = [];
  const structure = record(doc) ? doc.structure : null;
  if (!record(structure)) return problems;
  const rate = record(structure.canvas) ? structure.canvas.rate : null;
  const duration = structure.duration;
  if (!record(rate) || !record(duration)) return problems;
  const slots = Array.isArray(structure.slots) ? structure.slots : [];
  let expected = 0;
  let tiled = sameRate(duration.rate, rate);
  if (!tiled) problems.push({ jsonPath: 'structure.duration', rule: 'frame' });

  slots.forEach((slot, index) => {
    if (!record(slot)) return;
    const base = `structure.slots.${index}`;
    const startOk = sameRate(slot.start?.rate, rate);
    const durationOk = sameRate(slot.duration?.rate, rate);
    if (!startOk) problems.push({ jsonPath: `${base}.start`, rule: 'frame' });
    if (!durationOk) problems.push({ jsonPath: `${base}.duration`, rule: 'frame' });
    if (startOk && durationOk) {
      if (slot.start.value !== expected) problems.push({ jsonPath: `${base}.start`, rule: 'tiling' });
      if (!(slot.duration.value >= 1)) problems.push({ jsonPath: `${base}.duration`, rule: 'tiling' });
      expected += slot.duration.value;
    } else {
      tiled = false;
    }
    checkTransition(slot, slots[index - 1], index, base, rate, problems);
    checkRamp(slot.speedRamp, base, rate, problems);
    checkAnchor(slot, structure.beatMap, base, rate, problems);
  });
  if (tiled && expected !== duration.value) problems.push({ jsonPath: 'structure.duration', rule: 'tiling' });

  const pacing = structure.pacing;
  if (record(pacing)) {
    if (pacing.shotCount !== slots.length) problems.push({ jsonPath: 'structure.pacing.shotCount', rule: 'shotCount' });
    for (const key of ['meanShot', 'medianShot', 'shortestShot', 'longestShot', 'hookEnd']) {
      const time = pacing[key];
      if (record(time) && !sameRate(time.rate, rate)) problems.push({ jsonPath: `structure.pacing.${key}`, rule: 'frame' });
    }
  }

  const text = Array.isArray(structure.text) ? structure.text : [];
  text.forEach((item, index) => {
    if (!record(item)) return;
    const base = `structure.text.${index}`;
    const startOk = sameRate(item.start?.rate, rate);
    const durationOk = sameRate(item.duration?.rate, rate);
    if (!startOk) problems.push({ jsonPath: `${base}.start`, rule: 'frame' });
    if (!durationOk) problems.push({ jsonPath: `${base}.duration`, rule: 'frame' });
    if (startOk && durationOk && sameRate(duration.rate, rate)) {
      const end = item.start.value + item.duration.value;
      if (!(item.duration.value >= 1) || item.start.value < 0 || end > duration.value) {
        problems.push({ jsonPath: base, rule: 'overlay' });
      }
    }
  });
  return problems;
}

export function versionProblem(doc, previous) {
  if (!record(doc)) return { jsonPath: 'version', rule: 'version' };
  if (previous === null) {
    return doc.version === 1 ? null : { jsonPath: 'version', rule: 'version' };
  }
  if (!record(previous)) return { jsonPath: 'version', rule: 'version' };
  if (doc.id !== previous.id || doc.handle !== previous.handle || doc.version !== previous.version + 1) {
    return { jsonPath: 'version', rule: 'version' };
  }
  return null;
}

function checkTransition(slot, previous, index, base, rate, problems) {
  const transition = slot.transitionIn;
  if (!record(transition)) return;
  const at = `${base}.transitionIn`;
  if (index === 0) problems.push({ jsonPath: at, rule: 'tiling' });
  if (!sameRate(transition.before?.rate, rate)) problems.push({ jsonPath: `${at}.before`, rule: 'frame' });
  if (!sameRate(transition.after?.rate, rate)) problems.push({ jsonPath: `${at}.after`, rule: 'frame' });
  if (previous && record(previous.duration) && record(transition.before) && transition.before.value > previous.duration.value) {
    problems.push({ jsonPath: `${at}.before`, rule: 'tiling' });
  }
  if (record(slot.duration) && record(transition.after) && transition.after.value > slot.duration.value) {
    problems.push({ jsonPath: `${at}.after`, rule: 'tiling' });
  }
}

function checkRamp(ramp, base, rate, problems) {
  if (!record(ramp) || !Array.isArray(ramp.points)) return;
  ramp.points.forEach((point, index) => {
    if (!record(point) || sameRate(point.at?.rate, rate)) return;
    problems.push({ jsonPath: `${base}.speedRamp.points.${index}.at`, rule: 'frame' });
  });
}

function checkAnchor(slot, beatMap, base, rate, problems) {
  const anchor = slot.beatAnchor;
  if (!record(anchor)) return;
  const at = `${base}.beatAnchor`;
  const beats = record(beatMap) && Array.isArray(beatMap.beats) ? beatMap.beats : null;
  if (!beats || !Number.isInteger(anchor.beatIndex) || anchor.beatIndex < 0 || anchor.beatIndex >= beats.length) {
    problems.push({ jsonPath: at, rule: 'anchor' });
    return;
  }
  if (!sameRate(anchor.offset?.rate, rate)) {
    problems.push({ jsonPath: `${at}.offset`, rule: 'frame' });
    return;
  }
  if (!sameRate(slot.start?.rate, rate)) return;
  const beat = beats[anchor.beatIndex];
  if (!record(beat) || !record(beat.rate)) {
    problems.push({ jsonPath: at, rule: 'anchor' });
    return;
  }
  const landed = rescale(beat, rate) + anchor.offset.value;
  if (Math.abs(landed - slot.start.value) > 1) problems.push({ jsonPath: at, rule: 'anchor' });
}

function rescale(time, rate) {
  const numerator = time.value * time.rate.den * rate.num;
  const denominator = time.rate.num * rate.den;
  return Math.round(numerator / denominator);
}

function sameRate(left, right) {
  if (!record(left) || !record(right)) return false;
  const values = [left.num, left.den, right.num, right.den];
  if (!values.every((value) => Number.isFinite(value)) || left.den === 0 || right.den === 0) return false;
  return left.num * right.den === right.num * left.den;
}

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
