// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V5 FCPXML structure (CI's stand-in for the DTD, which lives inside Final Cut Pro.app): element order and
 * required attributes the 1.14 DTD asks for, times on frame boundaries, escaping of names in any script, paths
 * with spaces percent-encoded, and the same file every time.
 */
import { FrameRate, FrameRates, newId, type AssetId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { fcpxmlExporter, FCPXML_VERSION, writeFcpxml } from '../../src/interchange/fcpxml/fcpxml-exporter';
import { inexactTimes } from '../../src/interchange/fcpxml/read-back';
import { parseFcpTime } from '../../src/interchange/fcpxml/time';
import { attr, parseXml, type XmlNode } from '../../src/interchange/fcpxml/xml';
import { secondsToFrames } from '../../src/interchange/seconds';
import { originals, thirtyClipTimeline } from '../fixtures/interchange';

function parse(text: string): XmlNode {
  const parsed = parseXml(text);
  if (!parsed.ok) throw new Error(parsed.error.detail);
  return parsed.value;
}

const child = (node: XmlNode | undefined, name: string) => node?.children.find((item) => item.name === name);
const walk = (node: XmlNode, visit: (node: XmlNode) => void): void => {
  visit(node);
  node.children.forEach((item) => walk(item, visit));
};

const timeline = thirtyClipTimeline(FrameRates.fps29_97);

describe('FCPXML 1.14', () => {
  const text = writeFcpxml(timeline, { media: originals(timeline), pathStyle: 'fileUrl' });
  const root = parse(text);
  const sequence = child(child(child(child(root, 'library'), 'event'), 'project'), 'sequence');
  const spine = child(sequence, 'spine');

  it('is version 1.14 with resources then a library, and a sequence on the canvas format', () => {
    expect(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n')).toBe(true);
    expect(attr(root, 'version')).toBe(FCPXML_VERSION);
    expect(root.children.map((node) => node.name)).toEqual(['resources', 'library']);
    const format = child(root, 'resources')?.children.find(
      (node) => attr(node, 'id') === attr(sequence as XmlNode, 'format'),
    );
    expect(format && [attr(format, 'frameDuration'), attr(format, 'width'), attr(format, 'height')]).toEqual([
      '1001/30000s',
      '1080',
      '1920',
    ]);
    expect(
      sequence && [attr(sequence, 'tcStart'), attr(sequence, 'tcFormat'), attr(sequence, 'audioRate')],
    ).toEqual(['0s', 'NDF', '48k']);
  });

  it('gives every asset an id, a media-rep and its audio facts; every story element its required attributes', () => {
    for (const node of child(root, 'resources')?.children ?? []) {
      if (node.name !== 'asset') continue;
      expect(attr(node, 'id')).toMatch(/^r\d+$/);
      expect(node.children[0]?.name).toBe('media-rep');
      expect(attr(node.children[0] as XmlNode, 'src')).toMatch(/^file:\/\/\//);
      if (attr(node, 'hasAudio') === '1') expect(attr(node, 'audioRate')).toBe('48000');
    }
    walk(spine as XmlNode, (node) => {
      if (['asset-clip', 'video', 'gap'].includes(node.name)) expect(attr(node, 'duration')).not.toBeNull();
      if (node.name === 'asset-clip' || node.name === 'video') expect(attr(node, 'ref')).toMatch(/^r\d+$/);
    });
  });

  it('keeps the DTD order inside a clip: timeMap, volume, connected clips, then markers', () => {
    const rank = (name: string) => ['timeMap', 'adjust-volume', 'asset-clip', 'marker'].indexOf(name);
    walk(spine as XmlNode, (node) => {
      if (node.name !== 'asset-clip' && node.name !== 'video' && node.name !== 'gap') return;
      const ranks = node.children.map((item) => rank(item.name));
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    });
  });

  it('writes every time exactly, and spine times on the sequence frame grid', () => {
    expect(inexactTimes(text)).toEqual([]);
    for (const item of spine?.children ?? [])
      for (const key of ['offset', 'duration']) {
        const seconds = parseFcpTime(attr(item, key));
        expect(
          seconds && secondsToFrames(seconds, FrameRates.fps29_97),
          `${item.name}@${key}`,
        ).not.toBeNull();
      }
  });

  it('puts in-points on the asset frame grid', () => {
    const resources = child(root, 'resources')?.children ?? [];
    const rateOf = (assetRef: string) => {
      const asset = resources.find((node) => attr(node, 'id') === assetRef);
      const format = resources.find((node) => attr(node, 'id') === (asset && attr(asset, 'format')));
      const frame = parseFcpTime(format ? attr(format, 'frameDuration') : null);
      return frame ? FrameRate.of(Number(frame.den), Number(frame.num)) : null;
    };
    for (const item of spine?.children ?? []) {
      if (item.name !== 'asset-clip') continue;
      const rate = rateOf(attr(item, 'ref') ?? '');
      const start = parseFcpTime(attr(item, 'start'));
      expect(rate && start && secondsToFrames(start, rate)).not.toBeNull();
    }
  });

  it('escapes names with &, <, quotes and Devanagari, and percent-encodes paths with spaces', () => {
    const names = new Map<AssetId, string>();
    const strange = (assetId: AssetId) => {
      const name = names.get(assetId) ?? `Tom & "Jerry" <चाय> ${names.size}.mov`;
      names.set(assetId, name);
      return name;
    };
    const named = { ...timeline, name: 'Café & <चाय> "first"' };
    const written = writeFcpxml(named, { media: originals(named, new Set(), strange), pathStyle: 'fileUrl' });
    expect(written).not.toMatch(/name="[^"]*<[^"]*"/);
    expect(written).toContain('name="Café &amp; &lt;चाय&gt; &quot;first&quot;"');
    expect(written).toContain('Tom%20%26%20%22Jerry%22%20%3C%E0%A4%9A');
    const reparsed = parse(written);
    const project = child(child(child(reparsed, 'library'), 'event'), 'project');
    expect(project && attr(project, 'name')).toBe('Café & <चाय> "first"');
  });

  it('writes the same file every time', () => {
    expect(writeFcpxml(timeline, { media: originals(timeline), pathStyle: 'fileUrl' })).toBe(text);
  });

  it('names an offline original by its last known path, so Final Cut relinks it by name', () => {
    const [first] = timeline.tracks[0]?.items.filter((item) => item.type === 'clip') ?? [];
    const assetId = first?.type === 'clip' ? first.media.assetId : newId<'Asset'>();
    const media = originals(timeline, new Set([assetId]));
    const written = fcpxmlExporter.write(timeline, { media, pathStyle: 'posixPath' });
    if (!written.ok) throw new Error(written.error.detail);
    expect(written.value.text).toContain(`src="file:///Volumes/Shoot%20Day/${assetId}.mov"`);
    expect(written.value.warnings).toContainEqual({ code: 'mediaOffline', clipId: first?.id });
  });
});
