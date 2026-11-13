// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { AI_DEVICES, AI_MAP, AI_MAP_OBJECTS, AI_METER } from '#content/ai-map';
import { claimViolations } from '#content/claims';
import { LOCAL_ONLY, ON_DEVICE, PROFILES } from '#content/providers';
import { DEVICE_RUNS, deviceRun, segmentsFor, stepDevice } from '#components/your-ai/device/model';
import {
  aiHome,
  cloudSide,
  DEFAULT_STATE,
  lanes,
  leaves,
  LOCAL_PROFILE,
  type MapState,
  placeOf,
  profileLimit,
  profileLine,
  type ProfileName,
  splitRule,
  stepProfile,
} from '#components/your-ai/map/model';

/** AI1 lane M: the map of what leaves your computer and the memory meter say only what the app's own lists say. */

const NAMES = PROFILES.map(([name]) => name) as ProfileName[];
const STATES: MapState[] = NAMES.flatMap((profile) => [false, true].map((localOnly) => ({ profile, localOnly })));
const words = (s: MapState) => lanes(s).map((l) => [l.label, l.value] as const);

describe('the map of what leaves your computer', () => {
  it('opens on Everyday with Local only off', () => {
    expect(DEFAULT_STATE).toEqual({ profile: 'Everyday', localOnly: false });
  });

  it('with Local only off, crosses exactly the app’s list for the profile, then the update check', () => {
    for (const profile of NAMES) {
      const state = { profile, localOnly: false };
      const crossing = lanes(state).filter((l) => l.crosses && l.id !== 'updates');
      const app = leaves(profile).filter(([, value]) => value !== LOCAL_ONLY.cloudWithLocalProfile);
      expect(crossing.map((l) => [l.label, l.value]), profile).toEqual(app);
      expect(lanes(state).at(-1), profile).toMatchObject({ id: 'updates', value: LOCAL_ONLY.stillRuns, crosses: true });
    }
  });

  it('keeps leaves() the app’s list: On this Mac drops speech and reads no cloud model', () => {
    expect(leaves('Everyday')).toEqual(LOCAL_ONLY.leavesWhenOff);
    const local = leaves(LOCAL_PROFILE);
    expect(local.map(([label]) => label)).not.toContain('Speech');
    expect(local[0]).toEqual(['Cloud models you chose', LOCAL_ONLY.cloudWithLocalProfile]);
  });

  it('under On this Mac keeps the cloud lane home, drops speech, moves the AI here and reads no cloud model', () => {
    const state = { profile: LOCAL_PROFILE, localOnly: false };
    const cloud = lanes(state).find((l) => l.id === 'cloud');
    expect(cloud).toMatchObject({ crosses: false, value: null });
    expect(lanes(state).map((l) => l.id)).not.toContain('speech');
    expect(aiHome(state)).toBe('computer');
    expect(cloudSide(state)).toEqual({ kind: 'none', words: LOCAL_ONLY.cloudWithLocalProfile });
    expect(profileLimit()).toBe('Lower quality, and no AI voice or images.');
    expect(profileLine(LOCAL_PROFILE).endsWith(profileLimit())).toBe(true);
  });

  it('with Local only on, stops everything at the wall but the update check, and says what stays', () => {
    for (const profile of NAMES) {
      const state = { profile, localOnly: true };
      expect(lanes(state).filter((l) => l.crosses).map((l) => l.id), profile).toEqual(['updates']);
      expect(cloudSide(state), profile).toEqual({ kind: 'closed', words: LOCAL_ONLY.whenOn });
      // Reel links and jobs with no local model stand on their lanes; your footage is the map's own caption.
      for (const fact of LOCAL_ONLY.staysWhenOn.slice(1)) expect(words(state), profile).toContainEqual(fact);
    }
  });

  it('rests each card where its lane goes: the AI, outside, home with the AI, or held at the wall', () => {
    for (const state of STATES) {
      const places = Object.fromEntries(lanes(state).map((l) => [l.id, placeOf(l, state)]));
      const local = state.profile === LOCAL_PROFILE;
      expect(places.cloud, JSON.stringify(state)).toBe(local ? 'local' : state.localOnly ? 'held' : 'ai');
      expect(places.updates, JSON.stringify(state)).toBe('outside');
      for (const id of ['links', 'speech', 'reports'] as const) {
        if (id in places) expect(places[id], `${id} ${JSON.stringify(state)}`).toBe(state.localOnly ? 'held' : 'outside');
      }
      // A card is outside your computer exactly when its lane crosses.
      for (const l of lanes(state)) expect(['ai', 'outside'].includes(placeOf(l, state)), l.id).toBe(l.crosses);
    }
  });

  it('shows the cloud model’s profile, by its app name, for every other state', () => {
    for (const profile of NAMES.filter((n) => n !== LOCAL_PROFILE)) {
      expect(cloudSide({ profile, localOnly: false })).toEqual({ kind: 'model', name: profile });
      expect(aiHome({ profile, localOnly: false })).toBe('cloud');
    }
  });

  it('says every lane in the app’s words only', () => {
    const allowed = new Set<string>([
      ...LOCAL_ONLY.leavesWhenOff.flat(),
      ...LOCAL_ONLY.staysWhenOn.flat(),
      LOCAL_ONLY.stillRuns,
      AI_MAP.updates,
    ]);
    for (const s of STATES) for (const [label, value] of words(s)) for (const w of [label, value]) if (w !== null) expect(allowed.has(w), w).toBe(true);
  });

  it('splits the cloud lane’s words round its rule, word for word', () => {
    const value = LOCAL_ONLY.leavesWhenOff[0]![1];
    const [lead, rule] = splitRule(value);
    expect(rule).toBe('Taalcut asks before it first sends your files to a cloud model.');
    expect(`${lead} ${rule}`).toBe(value);
  });

  it('moves between profiles by arrow key, wrapping, with Home and End', () => {
    expect(stepProfile(1, 'ArrowRight')).toBe(2);
    expect(stepProfile(0, 'ArrowLeft')).toBe(3);
    expect(stepProfile(3, 'ArrowDown')).toBe(0);
    expect(stepProfile(2, 'Home')).toBe(0);
    expect(stepProfile(0, 'End')).toBe(3);
    expect(stepProfile(0, 'Enter')).toBeNull();
  });
});

describe('the memory meter', () => {
  const facts = ON_DEVICE.facts;
  const said = (word: string) => facts.some(([, value]) => value.toLowerCase().includes(word.toLowerCase()));

  it('offers the four computers the facts name, each by its brand', () => {
    expect(DEVICE_RUNS.map((d) => [d.name, d.brand, d.memory])).toEqual(AI_DEVICES.map((d) => [d.name, d.brand, d.memory]));
  });

  it('puts only fact words in big type', () => {
    for (const d of DEVICE_RUNS) {
      expect(said(d.model), d.model).toBe(true);
      if (d.runtime) expect(said(d.runtime), d.runtime).toBe(true);
      for (const f of d.agent) expect(facts, d.id).toContainEqual(f);
      // The big words come from the very facts this computer shows.
      expect(d.agent.some(([, v]) => v.toLowerCase().includes(d.model.replace(/^A /, '').toLowerCase())), d.id).toBe(true);
    }
  });

  it('ties each fact to the computer it names, and the 16 GB floor to Mac and Ubuntu alike', () => {
    const [, , agent4b, ubuntu, high, small] = facts;
    expect(deviceRun('mac-8')).toMatchObject({ memory: 8, model: 'A small text model', agent: [small], imagesInCloud: true });
    expect(deviceRun('mac-16')).toMatchObject({ memory: 16, orMore: true, model: 'Qwen3.5 4B', runtime: 'through llama.cpp', agent: [agent4b] });
    expect(deviceRun('mac-32')).toMatchObject({ memory: 32, model: 'Qwen3.5 9B', runtime: 'on MLX', agent: [high], gpuCores: 16 });
    expect(deviceRun('ubuntu')).toMatchObject({ memory: 16, orMore: true, model: 'Qwen3.5 4B', agent: [agent4b, ubuntu], videoMemory: 8 });
    expect(agent4b![1]).toContain('16 GB of memory or more');
    expect(ubuntu![1]).toContain('8 GB of video memory');
    expect(high![1]).toContain('32 GB of memory and a GPU with 16 or more cores');
    expect(small![1]).toContain(`${AI_METER.images} needs a cloud model`);
    // Every one of the six facts is shown by some computer, or at every size.
    const shown = new Set([facts[0], facts[1], ...DEVICE_RUNS.flatMap((d) => d.agent)]);
    expect(shown.size).toBe(facts.length);
  });

  it('fills a segment for every 4 GB', () => {
    expect(DEVICE_RUNS.map((d) => segmentsFor(d.memory))).toEqual([2, 4, 8, 4]);
    expect(segmentsFor(64)).toBe(8);
    expect(stepDevice(3, 'ArrowRight')).toBe(0);
    expect(stepDevice(0, 'End')).toBe(3);
  });
});

describe('lane M’s own words', () => {
  it('break no claim and name the always-local jobs as the facts do', () => {
    const own: string[] = [
      ...Object.values(AI_MAP).flat(),
      ...Object.values(AI_MAP_OBJECTS),
      ...Object.values(AI_METER).flat(),
      ...AI_DEVICES.map((d) => d.name),
    ];
    expect(own.flatMap(claimViolations)).toEqual([]);
    expect(ON_DEVICE.facts[0]![1].toLowerCase()).toContain(AI_MAP.jobs.join(', ').replace(', Music', ' and music').toLowerCase());
  });

  it('name each crossing object in its own fact’s words', () => {
    const fact = (i: number) => LOCAL_ONLY.leavesWhenOff[i]![1].toLowerCase();
    expect(fact(1)).toContain(AI_MAP_OBJECTS.link.toLowerCase());
    expect(fact(2)).toContain(AI_MAP_OBJECTS.speech.toLowerCase());
    expect(fact(3)).toContain('when you turn them on');
    expect(AI_MAP_OBJECTS.reports.toLowerCase()).toContain('turn them on');
    expect(LOCAL_ONLY.stillRuns.toLowerCase()).toContain(AI_MAP_OBJECTS.updates.toLowerCase());
  });
});
