// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: models-settings · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · hairline sections, the profiles as one radio list, one quiet secondary "Use
 *   recommended" as a plain line, the models on this Mac with their downloads (UX2-MODELS,
 *   downloads/models-on-this-mac.tsx), the jobs under Advanced as rows of one list (UX1), no motion
 * states: default · hover · focus · active · disabled (busy) · Local only on (a line over the profiles) · loading (the
 *   named skeleton) · error (alert) · success (silent: announced to screen readers)
 */
import { msg } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import {
  type ModelModuleId,
  MODEL_COMMANDS,
  type ModelSettings,
  type ModuleOverride,
  type ModuleQuality,
} from '@taalcut/core';
import { Button, cn, Collapse, PageSection, Skeleton, useHostPlatform, VERB_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { useId, useReducer, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useCommand, type CommandRequest } from '../../../backend/use-command';
import { useRpcStream } from '../../../backend/use-rpc';
import { LoadError, Notice } from '../fields';
import { describeError, translateKey } from '../model-messages';
import { qualityFor } from '../privacy/quality-labels';
import { LocalOnlyQuality } from './local-only-quality';
import { useModelOptions } from './model-options';
import { ModuleRow } from './module-row';
import { ProfilePicker } from './profile-picker';
import { RetirementNotices } from './retirement-notices';
import { ModelsBones } from './models-bones';
import { SettingRows } from '../rows';
import { SETTINGS_ICONS } from '../settings-icons';
import { SettingsPage } from '../settings-page';
import { ModelsViews } from './models-views';

/** The profile that runs every job on this Mac (core's built-in id). */
const LOCAL_PROFILE = 'local-only';

const PROFILE_FALLBACK = msg`your profile`;

export interface ModelsSettingsProps {
  /** Advanced is open (the route keeps it in ?advanced, so ⌘K can open it). */
  advanced: boolean;
  onAdvancedChange: (open: boolean) => void;
}

/**
 * Settings › Models (P1-H5, PRD 8.4 and 9.4): a profile for everything, and
 * under Advanced a model and thinking level per job. Every change is a command
 * and applies to the next call, with no restart. The page follows
 * models.changed, so a switch made elsewhere (⌘K, the agent) shows at once.
 */
export function ModelsSettings({ advanced, onAdvancedChange }: ModelsSettingsProps) {
  const { t, i18n } = useLingui();
  const platform = useHostPlatform();
  const backend = useBackend();
  // Try again re-opens the stream (a new round).
  const [round, retry] = useReducer((n: number) => n + 1, 0);
  const settings = useRpcStream((signal) => backend.models.changed(undefined, { signal }), [backend, round]);
  // P3-B10: with Local only on, the jobs that are simpler here or off say so.
  const privacy = useRpcStream((signal) => backend.privacy.changed(undefined, { signal }), [backend]);
  const quality = privacy.data?.localOnly ? privacy.data.quality : [];
  const options = useModelOptions();
  const command = useCommand({ toast: false });
  const [failure, setFailure] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const advancedId = useId();

  async function run(request: CommandRequest, done: string) {
    setFailure(null);
    const result = await command.run(request);
    if (result.ok) setAnnouncement(done);
    else setFailure(describeError(i18n, result.error, platform));
  }

  const profileLabel = (s: ModelSettings, id: string) =>
    translateKey(i18n, s.profiles.find((p) => p.id === id)?.labelKey ?? '', PROFILE_FALLBACK, platform);

  return (
    <SettingsPage
      title={t`Models`}
      views={<ModelsViews current="profile" />}
      description={<Trans>Which AI does each job, and how hard it thinks.</Trans>}
    >
      {settings.status === 'error' && !settings.data ? (
        <LoadError error={settings.error} onRetry={retry} what={<Trans>Models didn’t load.</Trans>} />
      ) : null}
      <Skeleton name="settings-models" loading={settings.status === 'loading'} fixture={<ModelsBones />}>
        {settings.data ? (
          <SettingsBody
            settings={settings.data}
            quality={quality}
            localOnly={privacy.data?.localOnly === true}
            options={options.data}
            busy={command.pending}
            failure={failure}
            advanced={advanced}
            advancedId={advancedId}
            onAdvancedChange={onAdvancedChange}
            onProfile={(profileId) => {
              const name = settings.data ? profileLabel(settings.data, profileId) : profileId;
              void run(
                { name: MODEL_COMMANDS.setProfile, payload: { profileId } },
                t`Now using ${name}. Your next request uses it.`,
              );
            }}
            onRecommended={() =>
              void run(
                { name: MODEL_COMMANDS.useRecommended, payload: {} },
                t`Back to the recommended setup.`,
              )
            }
            onOverride={(module, override) =>
              void run(
                { name: MODEL_COMMANDS.setModuleOverride, payload: { module, override } },
                t`Saved. The next request for this job uses it.`,
              )
            }
            onReset={(module) =>
              void run(
                { name: MODEL_COMMANDS.clearModuleOverride, payload: { module } },
                t`Back to the profile’s choice.`,
              )
            }
          />
        ) : null}
      </Skeleton>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </SettingsPage>
  );
}

function SettingsBody({
  settings,
  quality,
  localOnly,
  options,
  busy,
  failure,
  advanced,
  advancedId,
  onAdvancedChange,
  onProfile,
  onRecommended,
  onOverride,
  onReset,
}: {
  settings: ModelSettings;
  quality: readonly ModuleQuality[];
  /** Privacy's Local only is on: every job uses the models on this Mac, whatever profile is chosen. */
  localOnly: boolean;
  options: ReturnType<typeof useModelOptions>['data'];
  busy: boolean;
  failure: string | null;
  advanced: boolean;
  advancedId: string;
  onAdvancedChange: (open: boolean) => void;
  onProfile: (profileId: string) => void;
  onRecommended: () => void;
  onOverride: (module: ModelModuleId, override: ModuleOverride) => void;
  onReset: (module: ModelModuleId) => void;
}) {
  const { t } = useLingui();
  // The jobs are built the first time Advanced opens (not on every visit), then kept for its closing motion.
  const [opened, setOpened] = useState(advanced);
  if (advanced && !opened) setOpened(true);
  const changed = settings.modules.filter((m) => m.override).length;
  const offRecommended = changed > 0 || settings.activeProfileId !== settings.recommendedProfileId;
  // Privacy's Local only and this choice (M9): with it on, a line says what it does to the profile in use.
  const privacy = (
    <Link to="/settings/privacy" className="type-label text-ink underline underline-offset-4">
      <Trans>Privacy</Trans>
    </Link>
  );
  const note = !localOnly ? undefined : settings.activeProfileId === LOCAL_PROFILE ? (
    <Trans>Local only is on in {privacy}, and On this Mac runs each job on this Mac.</Trans>
  ) : (
    <Trans>
      Local only is on in {privacy}, so the jobs this profile sends to the cloud are off. Choose On this Mac
      to run them here.
    </Trans>
  );

  return (
    <div className="flex flex-col gap-10 [&>[data-slot=page-section]]:mt-0!">
      <RetirementNotices
        settings={settings}
        options={options}
        busy={busy}
        onSwitch={(notice, replacement) =>
          onOverride(notice.module, {
            ...settings.modules.find((m) => m.module === notice.module)?.override,
            primary: { provider: replacement.provider, model: replacement.model },
          })
        }
      />
      <LocalOnlyQuality quality={quality} />
      {failure ? (
        <Notice tone="danger" role="alert">
          {failure}
        </Notice>
      ) : null}

      <PageSection
        title={<Trans>How should Taalcut think?</Trans>}
        icon={SETTINGS_ICONS.profile}
        description={<Trans>Pick one. It changes the next request; nothing restarts.</Trans>}
      >
        <ProfilePicker settings={settings} busy={busy} onChoose={onProfile} note={note} />
        {offRecommended ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 type-body text-ink-2">
              {changed > 0 ? (
                <Plural
                  value={changed}
                  one="You chose your own model for # job."
                  other="You chose your own models for # jobs."
                />
              ) : (
                <Trans>This isn’t the setup Taalcut recommends for this Mac.</Trans>
              )}
            </p>
            <Button
              size="sm"
              variant="secondary"
              icon={VERB_ICONS.undo}
              disabled={busy}
              onClick={onRecommended}
            >
              <Trans>Use recommended</Trans>
            </Button>
          </div>
        ) : null}
      </PageSection>

      <PageSection
        title={<Trans>Advanced</Trans>}
        icon={SETTINGS_ICONS.jobs}
        description={
          <Trans>Choose the model and thinking level for each job. Most people never need this.</Trans>
        }
        actions={
          <Button
            aria-expanded={advanced}
            aria-controls={advancedId}
            onClick={() => onAdvancedChange(!advanced)}
          >
            {/* The chevron turns as the jobs open (UX4 motion grammar: Collapse), held still under reduced motion. */}
            <ChevronDown
              aria-hidden
              className={cn(
                'transition-transform duration-(--dur-short) ease-(--ease-in-out) motion-reduce:transition-none',
                advanced && 'rotate-180',
              )}
            />
            {advanced ? <Trans>Hide jobs</Trans> : <Trans>Show jobs</Trans>}
          </Button>
        }
      >
        {/* Built the first time it opens, then kept (inert while closed) so closing eases instead of vanishing. */}
        <Collapse id={advancedId} open={advanced}>
          {opened ? (
            <SettingRows aria-label={t`Jobs`}>
              {settings.modules.map((module) => (
                <ModuleRow
                  key={module.module}
                  module={module}
                  quality={qualityFor(quality, module.module)}
                  options={options}
                  busy={busy}
                  onOverride={(override) => onOverride(module.module, override)}
                  onReset={() => onReset(module.module)}
                />
              ))}
            </SettingRows>
          ) : null}
        </Collapse>
      </PageSection>
    </div>
  );
}
