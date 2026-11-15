// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TRIM1: every state of "pick the part". Disabled while another edit is on its way or the scene is locked; bones
 * while the file's detail loads; a file that can't be read, whose original is away, or that has no filmstrip says
 * so and what still works; a photo and a held moment have no part to pick; the picture shows the frame being
 * chosen and Play runs just the part; the scene card's picture is a frame from the part the scene plays.
 */
import type { Timeline } from '@taalcut/core';
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClipPart } from '../src/features/timeline/clip-part/clip-part';
import { ClipTrimControls } from '../src/features/timeline/clip-trim-controls';
import { buildModel } from '../src/features/timeline/model';
import { SceneStrip } from '../src/features/timeline/scene-strip';
import type { ShotLookup } from '../src/features/timeline/shot-frames';
import {
  FILE,
  fileDetail,
  fileLookup,
  layOutStrip,
  partFixture,
  partTimeline,
  type PartFixtureOptions,
} from './clip-part-support';
import { LoadedImage, pointer } from './other-shots-support';
import { EditorTestProvider, mountEditorControl } from './simple-editor-support';

function mount(options: PartFixtureOptions & { lookup?: ShotLookup; pending?: boolean } = {}) {
  const f = partFixture(options);
  const edits = { ...f.edits, pending: options.pending ?? false };
  const lookup = options.lookup ?? fileLookup({ strip: 10 });
  const view = mountEditorControl(<ClipPart clip={f.clip} model={f.model} edits={edits} lookup={lookup} />);
  const strip = view.container.querySelector('[data-slot=part-strip]');
  if (strip) layOutStrip(strip);
  return { ...f, edits, lookup, view, strip };
}

const flush = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));

afterEach(() => vi.unstubAllGlobals());

describe('pick the part: when it can’t be changed (TRIM1)', () => {
  it('is off while another edit is on its way: nothing drags, nothing steps, and it says why', async () => {
    const { command, edits } = mount({ pending: true });
    const part = screen.getByRole('slider', { name: 'The part scene 3 plays' });
    expect(part.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('slider', { name: 'Where scene 3 ends' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    pointer(part, 'pointerdown', { x: 45, held: 1 });
    pointer(part, 'pointermove', { x: 90, held: 1 });
    pointer(part, 'pointerup', { x: 90 });
    fireEvent.keyDown(part, { key: 'ArrowRight' });
    const later = screen.getByRole<HTMLButtonElement>('button', { name: '1 frame later' });
    expect(later.disabled).toBe(true);
    expect(later.title).toBe('Wait for the current edit to finish');
    fireEvent.click(later);
    await flush();
    expect(part.style.left).toBe('10%');
    expect(command).not.toHaveBeenCalled();
    expect(edits.trim).not.toHaveBeenCalled();
  });

  it('is off for a locked scene, which says how to change it', () => {
    mount({ patch: (clip) => ({ ...clip, locked: true }) });
    expect(screen.getByRole('slider', { name: 'The part scene 3 plays' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '0.5s earlier' }).title).toBe(
      'Unlock this scene to trim it',
    );
    expect(
      screen.getByText('Locked: Taalcut and your edits leave it as it is. Unlock it to change it.'),
    ).toBeTruthy();
  });
});

describe('pick the part: the file behind it (TRIM1)', () => {
  it('draws bones the size of the picture and the strip while the file loads, with the times it already knows', () => {
    const { view, strip } = mount({ lookup: fileLookup({ detail: 'loading' }) });
    expect(strip!.getAttribute('data-state')).toBe('loading');
    expect(view.container.querySelector('[data-slot=part-monitor]')!.className).toContain('tc-bone');
    expect(view.container.querySelector('[data-slot=part-picture]')).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.getByText('Plays 1.0s to 2.0s of a 10s clip')).toBeTruthy();
  });

  it('says a file that couldn’t be read still steps and trims, and tries again when asked', async () => {
    const lookup = fileLookup({ detail: null });
    const detail = vi.spyOn(lookup, 'detail');
    const { strip } = mount({ lookup });
    await flush();
    expect(
      screen.getByText(
        'Taalcut couldn’t read this clip, so its frames don’t show. The steps and the exact trim still work.',
      ),
    ).toBeTruthy();
    expect(strip!.getAttribute('data-state')).toBe('plain');
    expect(screen.getByRole('slider', { name: 'The part scene 3 plays' })).toBeTruthy();
    const asked = detail.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await flush();
    expect(detail.mock.calls.length).toBe(asked + 1);
  });

  it('says so when the clip’s original is away, and what still works', () => {
    mount({ lookup: fileLookup({ detail: fileDetail({ availability: 'offline' }), strip: 10 }) });
    expect(
      screen.getByText(
        'This clip’s original isn’t connected right now. You can still pick the part; connect it before you export.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole('slider', { name: 'The part scene 3 plays' }).getAttribute('aria-disabled'),
    ).toBeNull();
  });

  it('draws a plain track with the shots’ marks for a file without a filmstrip, and says the times still hold', () => {
    const { view, strip } = mount({ lookup: fileLookup() });
    expect(strip!.getAttribute('data-state')).toBe('plain');
    expect(view.container.querySelectorAll('[data-slot=part-cut]')).toHaveLength(1);
    expect(view.container.querySelector('[data-slot=part-no-frames]')!.textContent).toContain(
      'The part still moves: go by its times.',
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Play this part' }).disabled).toBe(true);
  });

  it('has no part to pick for a photo or a held moment: the exact trim, open, and why', () => {
    const photo = mount({
      patch: (clip) => ({ ...clip, media: { kind: 'image', assetId: FILE, shotId: null } }) as typeof clip,
    });
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.getByText(/^A photo shows whole, so there is no part to pick\./)).toBeTruthy();
    expect(photo.view.container.querySelector<HTMLDetailsElement>('[data-slot=exact-trim]')!.open).toBe(true);
    photo.view.unmount();
    mount({ patch: (clip) => ({ ...clip, holdFrame: clip.sourceStart }) });
    expect(
      screen.getByText(/^This scene holds one moment still, so there is no part to pick\./),
    ).toBeTruthy();
  });

  it('keeps the exact Remove and Restore folded under the control', () => {
    const { view, edits, clip } = mount();
    const fold = view.container.querySelector<HTMLDetailsElement>('[data-slot=exact-trim]')!;
    expect(fold.open).toBe(false);
    expect(fold.querySelector('summary')!.textContent).toBe('Trim by an exact amount');
    fireEvent.click(screen.getAllByRole('button', { name: /^Remove / })[1]!);
    expect(edits.trim).toHaveBeenCalledWith(clip.item.id, 'end', expect.any(Number));
  });
});

describe('pick the part: checking it (TRIM1)', () => {
  it('shows the part’s first frame, then the frame under the end being dragged', async () => {
    vi.stubGlobal('Image', LoadedImage);
    // Ten filmstrip frames a second apart.
    const { view } = mount();
    await flush();
    const frame = () => view.container.querySelector('[data-slot=part-frame]')!.getAttribute('data-frame');
    expect(frame()).toBe('1');
    expect(screen.getByRole('img', { name: 'The first frame the scene plays' })).toBeTruthy();
    const end = screen.getByRole('slider', { name: 'Where scene 3 ends' });
    pointer(end, 'pointerdown', { x: 60, held: 1 });
    pointer(end, 'pointermove', { x: 75, held: 1 });
    // The last frame it would show: frame 74 of the file, 2.47 s in.
    expect(frame()).toBe('2');
    expect(screen.getByRole('img', { name: 'The last frame the scene would play' })).toBeTruthy();
    pointer(end, 'pointerup', { x: 75 });
  });

  it('shows the frame under the pointer along the strip', async () => {
    vi.stubGlobal('Image', LoadedImage);
    const { view, strip } = mount();
    await flush();
    pointer(strip!, 'pointermove', { x: 240 });
    expect(view.container.querySelector('[data-slot=part-frame]')!.getAttribute('data-frame')).toBe('8');
    expect(screen.getByRole('img', { name: 'The frame under the pointer' })).toBeTruthy();
    fireEvent.pointerLeave(strip!);
    expect(view.container.querySelector('[data-slot=part-frame]')!.getAttribute('data-frame')).toBe('1');
  });

  it('plays just the part from its first frame, and stops when the part is dragged', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const { view } = mount({ lookup: fileLookup({ strip: 10, playback: 'copy.mp4' }) });
    const video = view.container.querySelector<HTMLVideoElement>('[data-slot=part-video]')!;
    expect(video.getAttribute('src')).toBe('copy.mp4');
    const button = screen.getByRole('button', { name: 'Play this part' });
    fireEvent.click(button);
    expect(play).toHaveBeenCalledTimes(1);
    expect(video.currentTime).toBeCloseTo(1, 3);
    expect(screen.getByRole('button', { name: 'Pause' }).getAttribute('aria-pressed')).toBe('true');
    const part = screen.getByRole('slider', { name: 'The part scene 3 plays' });
    pointer(part, 'pointerdown', { x: 45, held: 1 });
    await flush();
    expect(pause).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Play this part' }).getAttribute('aria-pressed')).toBe('false');
    pointer(part, 'pointerup', { x: 45 });
    // Leaving the tool stops the video too: unmounted while jsdom's missing pause() is still stood in for.
    view.unmount();
    play.mockRestore();
    pause.mockRestore();
  });
});

describe('the scene card shows the part its scene plays (TRIM1)', () => {
  const cards = (timeline: Timeline, lookup: ShotLookup) => (
    <EditorTestProvider>
      <SceneStrip
        model={buildModel(timeline, null)}
        selectedIds={[]}
        onPick={vi.fn()}
        pictureFor={() => 'still.jpg'}
        lookup={lookup}
        onEdit={vi.fn()}
      />
    </EditorTestProvider>
  );

  it('draws a frame from the middle of the part, and follows the pick', async () => {
    vi.stubGlobal('Image', LoadedImage);
    // Ten filmstrip frames a second apart; the scene plays 0.8 s to 1.8 s of the file.
    const f = partFixture({ from: 24 });
    const lookup = fileLookup({ strip: 10 });
    const view = mountEditorControl(cards(f.timeline, lookup));
    await flush();
    const card = () => view.container.querySelector(`[data-scene-clip="${f.clip.item.id}"]`)!;
    // Its middle, 1.3 s in, is nearest the filmstrip's second frame.
    expect(card().querySelector('[data-slot=scene-frame]')!.getAttribute('data-frame')).toBe('1');
    expect(card().querySelector('img')).toBeNull();
    // The person picked the part from 5.8 s to 6.8 s.
    view.rerender(cards(partTimeline(f.timeline, { from: 174 }), lookup));
    expect(card().querySelector('[data-slot=scene-frame]')!.getAttribute('data-frame')).toBe('6');
  });

  it('keeps the shot’s own picture for a file without a filmstrip', async () => {
    const f = partFixture();
    const view = mountEditorControl(cards(f.timeline, fileLookup()));
    await flush();
    const card = view.container.querySelector(`[data-scene-clip="${f.clip.item.id}"]`)!;
    expect(card.querySelector('[data-slot=scene-frame]')).toBeNull();
    expect(card.querySelector('img')!.getAttribute('src')).toBe('still.jpg');
  });
});

describe('the exact trim says what really happens (TRIM1)', () => {
  const lines = (index: number) => {
    const f = partFixture({ index });
    const view = mountEditorControl(<ClipTrimControls clip={f.clip} model={f.model} edits={f.edits} />);
    const text = view.container.textContent ?? '';
    view.unmount();
    return text;
  };

  it('no longer says the following scenes move: the scene next to that end gives or takes the time', () => {
    const middle = lines(2);
    expect(middle).not.toContain('The following scenes move with the edit');
    expect(middle).toContain('Nothing else moves.');
    expect(middle).not.toContain('The video starts with this scene');
  });

  it('says the first scene’s beginning plays another part, and the last scene’s end changes the video', () => {
    expect(lines(0)).toContain(
      'The video starts with this scene: at its beginning, Remove plays a later part',
    );
    expect(lines(partFixture().model.clips.length - 1)).toContain(
      'At the end of the last scene, the video gets shorter or longer.',
    );
  });
});
