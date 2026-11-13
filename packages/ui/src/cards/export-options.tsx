// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · component: the review page's Options (UX4, B8) · Operate · system: DESIGN.md v0.7 (PageSection,
 *   Switch, the icon registry)
 * Everything the one approval decides besides "Export", behind one disclosure under the video: quick swaps on the
 *   cut, where it's going, the music (REF1: on with the reel's music, off with the add-the-sound steps for the
 *   chosen app), captions, the Content Credentials note, and the editor for anything more. Each
 *   is a level-3 PageSection led by its concept's glyph, so the region scans as the rest of the app's pages do.
 * states: as each control (eight states) · disabled (exporting or settled: every control off) · a swap being folded
 *   in (the cut dims) · a choice failed (the review page says why under its Export bar)
 * motion: the region opens with the kit's Collapse (the caller's); nothing in it moves on its own */
import { useLingui } from '@lingui/react/macro';
import { Button } from '#components/button';
import { PageSection } from '#components/page-section';
import { Switch } from '#components/switch';
import { CONCEPT_ICONS, VERB_ICONS } from '../icons/concepts';
import { ClipDetail } from '../make/clip-detail';
import { MiniTimeline } from '../make/mini-timeline';
import { MusicPathPicker } from '../make/music-path-picker';
import { PresetPicker } from '../make/preset-picker';
import { clipShot } from '../make/timeline-math';
import { useCardActions } from './card-actions';
import { ExportCredentialsField } from './export-credentials';
import type { ExportApprovalCard, ExportApprovalState } from './use-export-approval';

export interface ExportOptionsProps {
  readonly card: ExportApprovalCard;
  readonly state: ExportApprovalState;
}

/** The approval's other decisions, each a section of its own, for the review page's Options. */
export function ExportOptions({ card, state }: ExportOptionsProps) {
  const { t } = useLingui();
  const actions = useCardActions();
  const { live, off, preset } = state;
  const platform = preset === 'shorts' || preset === 'reels' || preset === 'tiktok' ? preset : null;
  // REF1: the app whose add-the-sound steps show when the music is off: the chosen preset's, as the export dialog
  // finds it, else the app the preset is named for.
  const app = state.options?.presets.find((each) => each.preset.id === preset)?.preset.platform ?? platform;
  return (
    <div data-slot="review-options" className="flex flex-col pt-2">
      {live ? (
        <PageSection
          level={3}
          icon={VERB_ICONS.swap}
          title={t`Quick swaps`}
          description={t`Pick a clip to swap it for another that fits its slot.`}
        >
          <MiniTimeline
            compact
            timeline={live}
            selectedClipId={state.openClip}
            dimmed={state.updating}
            onSelectClip={(clipId) => state.setOpenClip((was) => (was === null ? null : clipId))}
            onActivateClip={(clipId) => state.setOpenClip((was) => (was === clipId ? null : clipId))}
            frames={(clip) => state.frames(clipShot(clip))?.url}
          />
          {state.openClip ? (
            <ClipDetail
              swapsOnly
              projectId={card.projectId}
              timeline={live}
              clipId={state.openClip}
              disabled={off}
              onClose={() => state.setOpenClip(null)}
              onSwapped={state.markSwapped}
            />
          ) : null}
        </PageSection>
      ) : null}
      <PageSection level={3} icon={CONCEPT_ICONS.export} title={t`Where it’s going`}>
        <PresetPicker
          options={state.presetOptions}
          value={preset}
          onChange={state.setPreset}
          disabled={off}
        />
      </PageSection>
      <PageSection level={3} icon={CONCEPT_ICONS.music} title={t`Music`}>
        <MusicPathPicker
          value={state.music}
          onChange={state.chooseMusic}
          disabled={off || !live}
          referenceAudio={{
            available: (state.options?.music.referenceAudioAvailable ?? false) && live?.template != null,
          }}
          ownTrack={{ available: live?.music.path === 'ownTrack' }}
          platformSound={state.options?.music.platformSound ?? null}
          platform={app}
        />
      </PageSection>
      <PageSection level={3} icon={CONCEPT_ICONS.caption} title={t`Captions`}>
        <Switch
          checked={state.burnIn}
          onCheckedChange={(next) => void state.chooseCaptions(next)}
          disabled={off}
          label={t`Captions in the video`}
        />
      </PageSection>
      {state.credentials ? (
        <PageSection level={3} icon={CONCEPT_ICONS.privacy} title={t`Credits and labels`}>
          <ExportCredentialsField
            projectId={card.projectId}
            credentials={state.credentials}
            platform={platform}
            disabled={off}
          />
        </PageSection>
      ) : null}
      {actions.navigate ? (
        <PageSection
          level={3}
          icon={CONCEPT_ICONS.make}
          title={t`Anything else`}
          description={t`Framing, sound levels and the rest are in the editor.`}
        >
          <div>
            <Button
              variant="secondary"
              icon={VERB_ICONS.open}
              disabled={state.settled}
              onClick={() =>
                actions.navigate?.({
                  to: 'timeline',
                  projectId: card.projectId,
                  timelineId: card.timelineId,
                  exportDialog: true,
                })
              }
            >
              {t`Open in the editor`}
            </Button>
          </div>
        </PageSection>
      ) : null}
    </div>
  );
}
