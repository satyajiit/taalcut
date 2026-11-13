// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · views: a plugin › Tools and › Skills (UX4) · genre: atmospheric studio app (chrome modern-minimal) ·
 *   system: DESIGN.md v0.6 + UX4 (_orch/ux4/specs/design-set.md "One row")
 * Tools: what the plugin can do (its features, rows of facts that don't wash, since they aren't clickable), then
 *   the tools the AI can find with the access given, each with what it does to the service. Skills: the guides it
 *   brings, one row each with Read skill, which opens the guide under the row (the kit's Collapse: what is below
 *   moves with it) in a well
 * states: tools loading (a status line) · tools error (the cause, Try again) · no tools (why: not active, or no
 *   access chosen) · a skill loading (a status line) · its error (the cause, Try again) · a skill open (Hide skill) */
import { Trans, useLingui } from '@lingui/react/macro';
import type { PluginSkillContent, PluginView } from '@taalcut/core';
import { Button, Chip, Collapse, PageSection, VERB_ICONS } from '@taalcut/ui';
import { useId, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useRpcQuery } from '../../../backend/use-rpc';
import { LoadError } from '../fields';
import { SettingRow, SettingRows } from '../rows';
import { SETTINGS_ICONS } from '../settings-icons';
import { pluginText } from './plugin-text';

export function PluginCapabilities({ plugin }: { plugin: PluginView }) {
  const { t, i18n } = useLingui();
  return (
    <PageSection icon={SETTINGS_ICONS.plugins} title={<Trans>Features</Trans>}>
      <SettingRows aria-label={t`Features`}>
        {plugin.manifest.features.map((feature) => (
          <SettingRow
            key={feature.id}
            title={pluginText(i18n, feature.name)}
            description={pluginText(i18n, feature.description)}
          />
        ))}
      </SettingRows>
    </PageSection>
  );
}

export function PluginTools({ plugin }: { plugin: PluginView }) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const tools = useRpcQuery(
    async (signal) =>
      plugin.status === 'active' ? backend.plugins.tools({ pluginId: plugin.manifest.id }, { signal }) : [],
    [backend, plugin.manifest.id, plugin.status, plugin.grantedAccess.join(',')],
  );
  return (
    <PageSection
      icon={SETTINGS_ICONS.tools}
      title={<Trans>Tools</Trans>}
      description={
        <Trans>The AI can discover these tools. Your connection and access determine which it can run.</Trans>
      }
    >
      {tools.error ? (
        <LoadError error={tools.error} onRetry={tools.reload} what={<Trans>Tools didn’t load.</Trans>} />
      ) : null}
      {tools.status === 'loading' ? (
        <p role="status" className="m-0 type-body text-ink-2">
          <Trans>Loading tools…</Trans>
        </p>
      ) : null}
      {tools.data?.length === 0 ? (
        <p className="m-0 max-w-prose type-body text-ink-2">
          {plugin.status === 'active' ? (
            <Trans>Choose access above to make tools available to the AI.</Trans>
          ) : (
            <Trans>Connect and activate this plugin to discover its tools.</Trans>
          )}
        </p>
      ) : null}
      {tools.data && tools.data.length > 0 ? (
        <SettingRows aria-label={t`Tools`}>
          {tools.data.map((tool) => (
            <SettingRow
              key={tool.name}
              title={
                <span translate="no" className="break-words">
                  {tool.name}
                </span>
              }
              description={
                <span translate={tool.source === 'mcp' ? 'no' : undefined}>
                  {pluginText(i18n, tool.description)}
                </span>
              }
              status={
                <Chip tone="neutral">
                  {tool.sideEffect === 'read' ? <Trans>Read</Trans> : <Trans>External action</Trans>}
                </Chip>
              }
            />
          ))}
        </SettingRows>
      ) : null}
    </PageSection>
  );
}

function SkillContent({ content }: { content: PluginSkillContent }) {
  return (
    <pre
      translate="no"
      className="m-0 max-h-96 overflow-auto rounded-md bg-well p-4 font-sans type-body whitespace-pre-wrap text-ink-2"
    >
      {content.content}
    </pre>
  );
}

function PluginSkill({ pluginId, skillId }: { pluginId: string; skillId: string }) {
  const backend = useBackend();
  const skill = useRpcQuery(
    (signal) => backend.plugins.readSkill({ pluginId, skillId }, { signal }),
    [backend, pluginId, skillId],
  );
  if (skill.error)
    return (
      <LoadError error={skill.error} onRetry={skill.reload} what={<Trans>The skill didn’t load.</Trans>} />
    );
  return skill.data ? (
    <SkillContent content={skill.data} />
  ) : (
    <p role="status" className="m-0 type-body text-ink-2">
      <Trans>Loading skill…</Trans>
    </p>
  );
}

function SkillRow({
  pluginId,
  skill,
  open,
  onToggle,
}: {
  pluginId: string;
  skill: PluginView['manifest']['skills'][number];
  open: boolean;
  onToggle: () => void;
}) {
  const { i18n } = useLingui();
  const region = useId();
  // Read once opened: the guide stays mounted (and read) while it closes, so it never refetches on the way out.
  const [read, setRead] = useState(false);
  return (
    <SettingRow
      title={pluginText(i18n, skill.name)}
      description={pluginText(i18n, skill.description)}
      // The guide opens under the words: the button stays by the skill's name instead of sliding to the middle.
      className="items-start [&>[data-slot=list-row-actions]]:pt-2"
      control={
        <Button
          size="sm"
          icon={VERB_ICONS.open}
          aria-expanded={open}
          aria-controls={region}
          onClick={() => {
            setRead(true);
            onToggle();
          }}
        >
          {open ? <Trans>Hide skill</Trans> : <Trans>Read skill</Trans>}
        </Button>
      }
    >
      <Collapse id={region} open={open}>
        <div className="pt-2">{read ? <PluginSkill pluginId={pluginId} skillId={skill.id} /> : null}</div>
      </Collapse>
    </SettingRow>
  );
}

export function PluginSkills({ plugin }: { plugin: PluginView }) {
  const { t } = useLingui();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <PageSection
      icon={SETTINGS_ICONS.skills}
      title={<Trans>Skills</Trans>}
      description={
        <Trans>
          Skills guide the AI through this service. Reading a skill does not grant access to its tools.
        </Trans>
      }
    >
      <SettingRows aria-label={t`Skills`}>
        {plugin.manifest.skills.map((skill) => (
          <SkillRow
            key={skill.id}
            pluginId={plugin.manifest.id}
            skill={skill}
            open={open === skill.id}
            onToggle={() => setOpen(open === skill.id ? null : skill.id)}
          />
        ))}
      </SettingRows>
    </PageSection>
  );
}
