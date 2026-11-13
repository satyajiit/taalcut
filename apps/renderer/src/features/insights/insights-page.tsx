// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · page: Insights (/insights) · mode: Operate · system: DESIGN.md v0.7
 * Dedicated creative intelligence & recommendations hub. Houses the Instagram Edits tab (playable
 * trending audio with cover art thumbnails, both royalty-free and IG-licensed/original music filters,
 * and scene-locked Trending Reel Blueprints), inline plugin activation & connection controls, and
 * Postiz social channel readiness.
 * states: connected feed · plugin disabled · failed read · real preview · empty search
 * contrast: canvas page -> raised studio plates -> viewer-black cover art & 9:16 storyboards
 * reduced-motion: instant tab and filter transitions
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { Button, Chip, CONCEPT_ICONS, Input, Segmented, VERB_ICONS } from '@taalcut/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { askWith } from '../../chat/selection-store';
import { Page } from '../../shell/page';
import {
  buildAgentPromptFromTrack,
  type EditsAudioTrack,
  type EditsLicenseFilter,
  type EditsMusicTab,
} from '../make/edits-pulse-model';
import { useEditsFeed } from '../make/use-edits-feed';
import { describeError } from '../settings/model-messages';
import { usePluginActions, usePlugins } from '../settings/plugins/use-plugins';
import { useAudioPreview } from './audio-preview';
import { EditsTrackCard } from './edits-track-card';
import { PluginActivationCard } from './plugin-activation-card';
import { buildReelIdeaPrompt, type ReelIdea } from './reel-ideas-data';
import { ReelIdeasSection } from './reel-ideas-section';

const BeatIcon = CONCEPT_ICONS.beat;
/* eslint-disable lingui/no-unlocalized-strings -- Edits protocol enum values; displayed labels are translated. */
const MUSIC_TABS = {
  trending: 'Trending',
  forYou: 'For You',
  original: 'Original audio',
  royaltyFree: 'Royalty-free',
  saved: 'Saved',
} as const;
/* eslint-enable lingui/no-unlocalized-strings */

type InsightsSourceTab = 'instagram-edits' | 'reel-ideas' | 'postiz';

export function InsightsPage() {
  const { t, i18n } = useLingui();
  const navigate = useNavigate();
  const plugins = usePlugins();
  const pluginActions = usePluginActions(plugins.reload);

  const [sourceTab, setSourceTab] = useState<InsightsSourceTab>('instagram-edits');
  const [audioTab, setAudioTab] = useState<EditsMusicTab>(MUSIC_TABS.trending);
  const [licenseFilter, setLicenseFilter] = useState<EditsLicenseFilter>('any');
  const [query, setQuery] = useState('');
  const feed = useEditsFeed(audioTab, query, licenseFilter);
  const preview = useAudioPreview();
  const editsPlugin = plugins.data?.find((entry) => entry.manifest.id === 'instagram-edits');
  const postizPlugin = plugins.data?.find((entry) => entry.manifest.id === 'postiz');
  const selectedPlugin = sourceTab === 'postiz' ? postizPlugin : editsPlugin;

  useEffect(() => {
    preview.stop();
  }, [sourceTab, audioTab, query, licenseFilter, preview.stop]);

  const handleCutTrackWithAgent = useCallback(
    (track: EditsAudioTrack) => {
      askWith(buildAgentPromptFromTrack(track), []);
      void navigate({ to: '/chat' });
    },
    [navigate],
  );

  const handleCutIdeaWithAgent = useCallback(
    (idea: ReelIdea, pairedTrack?: EditsAudioTrack) => {
      askWith(buildReelIdeaPrompt(idea, pairedTrack), []);
      void navigate({ to: '/chat' });
    },
    [navigate],
  );

  return (
    <Page
      title={t`Insights`}
      description={t`Instagram Edits audio from your connected account and editable Reel ideas.`}
      width="wide"
      actions={
        <Button asChild size="sm" variant="primary" icon={VERB_ICONS.makeVideo}>
          <Link to="/create/new">{t`Make a video`}</Link>
        </Button>
      }
    >
      <div className="flex flex-col gap-6">
        {/* Source Tabs: Instagram Edits · Trending Reel Ideas · Postiz */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule pb-4">
          <Segmented<InsightsSourceTab>
            label={t`Insights source`}
            value={sourceTab}
            onChange={setSourceTab}
            options={[
              { value: 'instagram-edits', label: t`Instagram Edits` },
              { value: 'reel-ideas', label: t`Reel ideas` },
              { value: 'postiz', label: t`Postiz channels` },
            ]}
          />
          <div className="flex flex-wrap items-center gap-2">
            {feed.isLiveConnected && feed.canRead ? (
              <Chip tone="beat">{t`Instagram Edits connected`}</Chip>
            ) : (
              <Chip tone="neutral">{t`Instagram Edits not connected`}</Chip>
            )}
          </div>
        </div>

        {/* Inline Plugin Activation / Connection Status */}
        {selectedPlugin ? (
          <PluginActivationCard
            plugin={selectedPlugin}
            actions={pluginActions}
            onSyncComplete={() => {
              plugins.reload();
              feed.reload();
            }}
          />
        ) : null}

        {/* Instagram Edits Audio Studio */}
        {sourceTab === 'instagram-edits' ? (
          <section
            aria-label={t`Instagram Edits audio catalog`}
            data-slot="instagram-edits-pulse"
            className="flex flex-col gap-4"
          >
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex size-6 items-center justify-center rounded-md bg-beat-soft text-beat-strong">
                    <BeatIcon aria-hidden className="size-3.5" />
                  </span>
                  <h2 className="m-0 type-section text-ink">
                    <Trans>Instagram Edits Audio Pulse</Trans>
                  </h2>
                </div>
                <p className="m-0 type-body text-ink-2">
                  <Trans>
                    Browse tracks and hook markers supplied by Instagram Edits. Check the provider’s licence
                    terms before publishing. Remote audio previews are not available in Taalcut yet.
                  </Trans>
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                icon={VERB_ICONS.checkAgain}
                loading={feed.fetching}
                disabled={!feed.isLiveConnected || !feed.canRead}
                onClick={feed.reload}
              >{t`Refresh`}</Button>
            </div>

            {/* Audio Category + License Filter + Search */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rule bg-raised p-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <Segmented<EditsMusicTab>
                  label={t`Audio category`}
                  value={audioTab}
                  onChange={setAudioTab}
                  options={[
                    { value: MUSIC_TABS.trending, label: t`Trending` },
                    { value: MUSIC_TABS.forYou, label: t`For You` },
                    { value: MUSIC_TABS.original, label: t`Original audio` },
                    { value: MUSIC_TABS.royaltyFree, label: t`Royalty-free` },
                    { value: MUSIC_TABS.saved, label: t`Saved` },
                  ]}
                />
                <Segmented<EditsLicenseFilter>
                  label={t`Music license`}
                  value={licenseFilter}
                  onChange={setLicenseFilter}
                  options={[
                    { value: 'any', label: t`All licences` },
                    { value: 'licensed', label: t`IG licensed` },
                    { value: 'royaltyFree', label: t`Royalty-free` },
                  ]}
                />
              </div>
              <div className="w-full sm:w-64">
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t`Search tracks or artists…`}
                  aria-label={t`Search tracks or artists`}
                />
              </div>
            </div>

            {feed.error ? (
              <p role="alert" className="m-0 type-body text-danger-strong">
                {describeError(i18n, feed.error)}
              </p>
            ) : null}
            {preview.errorTrackId ? (
              <p role="alert" className="m-0 type-body text-danger-strong">
                <Trans>This audio preview could not be played.</Trans>
              </p>
            ) : null}
            {feed.tracks.length === 0 ? (
              <p role="status" className="m-0 type-body text-ink-2">
                {!feed.isLiveConnected ? (
                  <Trans>Connect Instagram Edits to browse tracks from your account.</Trans>
                ) : !feed.canRead ? (
                  <Trans>Allow music access in Instagram Edits connection settings to browse tracks.</Trans>
                ) : feed.fetching ? (
                  <Trans>Loading tracks from Instagram Edits…</Trans>
                ) : feed.error ? (
                  <Trans>Tracks could not be loaded. Try refreshing.</Trans>
                ) : (
                  <Trans>No tracks match this filter. Try another category or clear your search.</Trans>
                )}
              </p>
            ) : (
              <div
                role="list"
                aria-label={t`Instagram Edits audio tracks`}
                className="grid grid-cols-1 gap-3.5 md:grid-cols-2"
              >
                {feed.tracks.map((track) => {
                  const isPlaying = preview.playingTrackId === track.id;
                  return (
                    <EditsTrackCard
                      key={track.id}
                      track={track}
                      playing={isPlaying}
                      elapsedSeconds={isPlaying ? preview.elapsedSeconds : 0}
                      onTogglePlay={() => preview.toggleTrack(track)}
                      onSeek={(sec) => preview.seekTrack(track, sec)}
                      saving={feed.saving === track.id}
                      saveDisabled={feed.saving !== null}
                      onToggleSave={() => void feed.saveTrack(track)}
                      onCutWithAgent={() => void handleCutTrackWithAgent(track)}
                    />
                  );
                })}
              </div>
            )}
          </section>
        ) : null}

        {/* Trending Reel Blueprints (shown on Instagram Edits tab and dedicated Reel Ideas tab) */}
        {sourceTab === 'instagram-edits' || sourceTab === 'reel-ideas' ? (
          <ReelIdeasSection
            tracks={feed.tracks}
            playingTrackId={preview.playingTrackId}
            onTogglePlayTrack={(track) => preview.toggleTrack(track)}
            onCutIdeaWithAgent={(idea, pairedTrack) => void handleCutIdeaWithAgent(idea, pairedTrack)}
          />
        ) : null}
      </div>
    </Page>
  );
}
