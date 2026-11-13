// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * tc.js v2 (SPEC G.2): the one script of Taalcut's a composition runs, versioned with the package. It reads the
 * motion data from `#tc-data`, runs the SplitText splits it names, builds one paused GSAP timeline from the tweens
 * (every property, value and ease checked against the allowlists first), renders it to its end and back once so
 * every tween starts from the state the one before it left, and registers it as `window.__timelines['taalcut']`.
 * HyperFrames seeks it frame by frame in the preview and the export alike. Nothing here reads a clock, the network
 * or input, and nothing here turns text into markup: SplitText splits text nodes.
 */
import {
  EASE_PATTERN,
  EASES,
  MAX_REPEATS,
  MOTION_PROPERTIES,
  SPLIT_TYPES,
  STAGGER_ORDERS,
} from '../motion/motion-data';
import {
  NUMBER_OR_STRING_PROPERTIES,
  NUMBER_PROPERTIES,
  PATH_DATA,
  VALUE_PATTERNS,
} from '../motion/motion-values';

export const TC_RUNTIME_VERSION = 3;

/** The composition id HyperFrames keys timelines by. */
export const COMPOSITION_ID = 'taalcut';

const table = JSON.stringify({
  properties: MOTION_PROPERTIES,
  numbers: [...NUMBER_PROPERTIES],
  either: [...NUMBER_OR_STRING_PROPERTIES],
  patterns: VALUE_PATTERNS,
  path: PATH_DATA,
  eases: EASES,
  easePattern: EASE_PATTERN.source,
  orders: STAGGER_ORDERS,
  splits: SPLIT_TYPES,
  maxRepeats: MAX_REPEATS,
});

export const TC_RUNTIME_JS = `/* Taalcut composition runtime v${TC_RUNTIME_VERSION} */
(function () {
  'use strict';
  var gsap = window.gsap;
  if (!gsap) throw new Error('Taalcut: GSAP did not load');
  var T = ${table};
  var node = document.getElementById('tc-data');
  var data = JSON.parse((node && node.textContent) || '{}');
  var motion = data.motion || { tweens: [], splits: [] };
  var plugins = ['CustomEase', 'SplitText', 'DrawSVGPlugin', 'MorphSVGPlugin', 'MotionPathPlugin']
    .map(function (name) { return window[name]; })
    .filter(Boolean);
  if (plugins.length) gsap.registerPlugin.apply(gsap, plugins);
  gsap.config({ force3D: false, nullTargetWarn: false });

  var patterns = {};
  Object.keys(T.patterns).forEach(function (key) { patterns[key] = new RegExp('^(?:' + T.patterns[key] + ')$'); });
  var pathData = new RegExp('^' + T.path + '$');
  function fail(what) { throw new Error('Taalcut: refused ' + what); }
  function finite(value) { return typeof value === 'number' && isFinite(value); }
  function checkValue(property, value) {
    if (T.properties.indexOf(property) < 0) fail('property ' + property);
    if (property === 'motionPath') {
      if (!value || typeof value.path !== 'string' || !pathData.test(value.path) ||
          typeof value.autoRotate !== 'boolean' || !finite(value.start) || !finite(value.end)) fail('motionPath');
      return { path: value.path, autoRotate: value.autoRotate, start: value.start, end: value.end };
    }
    if (T.numbers.indexOf(property) >= 0) { if (!finite(value)) fail(property); return value; }
    if (T.either.indexOf(property) >= 0 && finite(value)) return value;
    if (typeof value !== 'string' || !patterns[property] || !patterns[property].test(value)) fail(property);
    return value;
  }
  function checkVars(vars) {
    var out = {};
    Object.keys(vars || {}).forEach(function (key) { out[key] = checkValue(key, vars[key]); });
    return out;
  }
  var customEases = {};
  var easePattern = new RegExp(T.easePattern);
  function easeOf(ease) {
    if (ease === undefined) return 'none';
    if (T.eases.indexOf(ease) >= 0 || (typeof ease === 'string' && easePattern.test(ease))) return ease;
    var bezier = /^cubic-bezier\\(\\s*(-?[\\d.]+),\\s*(-?[\\d.]+),\\s*(-?[\\d.]+),\\s*(-?[\\d.]+)\\s*\\)$/.exec(ease);
    if (!bezier || !window.CustomEase) fail('ease ' + ease);
    if (!customEases[ease]) {
      customEases[ease] = window.CustomEase.create('tc' + Object.keys(customEases).length, bezier.slice(1, 5).join(','));
    }
    return customEases[ease];
  }

  var splits = {};
  function split() {
    (motion.splits || []).forEach(function (spec) {
      var element = document.getElementById(spec.id);
      if (!element) return;
      if (!window.SplitText) fail('split without SplitText');
      if (T.splits.indexOf(spec.type) < 0) fail('split ' + spec.type);
      if (spec.mask !== undefined && (['lines', 'words', 'chars'].indexOf(spec.mask) < 0 || spec.type.split(',').indexOf(spec.mask) < 0))
        fail('mask ' + spec.mask);
      var options = { type: spec.type, aria: 'none', linesClass: 'tc-sl', wordsClass: 'tc-sw', charsClass: 'tc-sc' };
      if (spec.mask) options.mask = spec.mask;
      splits[spec.id] = window.SplitText.create(element, options);
    });
  }
  function targetsOf(targets) {
    if (targets.ids) {
      return targets.ids.map(function (id) { return document.getElementById(id); }).filter(Boolean);
    }
    var list = [];
    (targets.split || []).forEach(function (id) {
      var made = splits[id];
      if (made) list = list.concat(targets.unit === 'chars' ? made.chars : targets.unit === 'lines' ? made.lines : made.words);
    });
    return list;
  }

  function build() {
    split();
    var tl = gsap.timeline({ paused: true, defaults: { lazy: false, overwrite: false, immediateRender: false } });
    var clocks = {};
    (motion.tweens || []).forEach(function (tween) {
      var track = tl;
      if (tween.clock) {
        var clock = tween.clock;
        if (typeof clock.id !== 'string' || !finite(clock.start) || clock.start < 0 ||
            !finite(clock.duration) || clock.duration <= 0 || !finite(clock.sourceStart) || clock.sourceStart < 0) fail('clock');
        if (!clocks[clock.id]) clocks[clock.id] = { spec: clock,
          timeline: gsap.timeline({ paused: true, defaults: { lazy: false, overwrite: false, immediateRender: false } }) };
        track = clocks[clock.id].timeline;
      }
      var targets = targetsOf(tween.targets);
      if (!targets.length) return;
      if (!finite(tween.at) || !finite(tween.duration) || tween.at < 0 || tween.duration < 0) fail('time');
      var from = tween.method === 'from';
      if (tween.method !== undefined && !from) fail('method');
      var to = checkVars(from ? tween.from : tween.to);
      if (tween.duration === 0) { track.set(targets, to, tween.at); return; }
      to.duration = tween.duration;
      to.ease = easeOf(tween.ease);
      if (tween.immediateRender !== undefined) {
        if (typeof tween.immediateRender !== 'boolean') fail('immediateRender');
        to.immediateRender = tween.immediateRender;
      }
      if (tween.stagger) {
        var spread = tween.stagger;
        var each = typeof spread === 'object' && spread !== null && 'each' in spread;
        if (!finite(each ? spread.each : spread.amount) || T.orders.indexOf(spread.from) < 0) fail('stagger');
        to.stagger = each ? { each: spread.each, from: spread.from } : { amount: spread.amount, from: spread.from };
      }
      // HFW1: GSAP's own repeat, as a composition runs it (the whole tween again, back on every other run with yoyo).
      if (tween.repeat !== undefined) {
        var again = tween.repeat;
        if (!finite(again.count) || again.count < 1 || again.count > T.maxRepeats || Math.floor(again.count) !== again.count ||
            typeof again.yoyo !== 'boolean' || !finite(again.delay) || again.delay < 0) fail('repeat');
        to.repeat = again.count;
        to.yoyo = again.yoyo;
        to.repeatDelay = again.delay;
      }
      // HFW1: a composition's tl.from, as GSAP runs it; the end state is read when the timeline first renders it.
      if (from) track.from(targets, to, tween.at);
      else track.fromTo(targets, checkVars(tween.from), to, tween.at);
    });
    Object.keys(clocks).forEach(function (id) {
      var child = clocks[id].timeline, clock = clocks[id].spec;
      child.set({}, {}, clock.sourceStart + clock.duration);
      child.progress(1, true).progress(0, true);
      tl.fromTo(child, { time: clock.sourceStart }, { time: clock.sourceStart + clock.duration,
        duration: clock.duration, ease: 'none', immediateRender: true, lazy: false }, clock.start);
    });
    if (finite(data.duration) && data.duration > 0) tl.set({}, {}, data.duration);
    tl.progress(1, true).progress(0, true);
    window.__timelines = window.__timelines || {};
    window.__timelines['${COMPOSITION_ID}'] = tl;
    if (typeof window.__hfForceTimelineRebind === 'function') window.__hfForceTimelineRebind();
  }
  if ((motion.splits || []).length && document.fonts && document.fonts.ready) document.fonts.ready.then(build);
  else build();
})();
`;
