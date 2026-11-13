// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · Operate · component: editor toolbar (UX4: the icon registry) · system: DESIGN.md v0.6 + UX4
 * the window bar on the editor: "Make" and the project's name (as written), then which video is open, the
 *   Look menu, the Clean up, Versions and Chat toggles for the dock, and the screen's one marigold fill: "Export…".
 *   Each leads with its glyph from the registry (Versions the version's, Chat the chat's, Export… the export verb;
 *   Clean up its own brush, no longer the beat's glyph). Under 1280 px the Look menu and the toggles show their
 *   icon with the word in a tooltip (and to screen readers); Export… keeps its word
 * states: the kit's Button (default, hover, focus, active: gives by 2 %, disabled while nothing is cut, pressed:
 *   the toggles say so with aria-expanded and the selected wash) · loading: the title waits for the name
 * EDT1-CMT: a Comments toggle beside Chat, the speech mark the comments wear on the bed */
import { useLingui } from '@lingui/react/macro';
import type { ProjectId, Timeline, TimelineId, TimelineSummary } from '@taalcut/core';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  UserContent,
  VERB_ICONS,
} from '@taalcut/ui';
import { ToolbarActions, ToolbarTitle } from '../../shell/toolbar';
import { cleanupAvailable } from './cleanup/cleanup-panel';
import { type DockPanel } from './dock/editor-dock';
import { VideoSwitcher } from './video-switcher';

export interface EditorToolbarProps {
  projectId: ProjectId;
  /** The open video; null while it loads. */
  timeline: Timeline | null;
  name: string | undefined;
  videos: readonly TimelineSummary[];
  activeId: TimelineId | undefined;
  onPickVideo: (id: TimelineId) => void;
  dock: DockPanel | null;
  onDock: (panel: DockPanel | null) => void;
  canExport: boolean;
  onExport: () => void;
  /** No Export…: the compare view's Export all is the screen's one marigold fill (P3-V3). */
  hideExport?: boolean;
}

export function EditorToolbar({
  timeline,
  name,
  videos,
  activeId,
  onPickVideo,
  dock,
  onDock,
  canExport,
  onExport,
  hideExport = false,
}: EditorToolbarProps) {
  const { t } = useLingui();
  const toggle = (panel: DockPanel) => onDock(dock === panel ? null : panel);
  return (
    <>
      <ToolbarTitle
        title={t`Make`}
        {...(name
          ? {
              detail: (
                <UserContent translate="no" className="whitespace-nowrap">
                  {name}
                </UserContent>
              ),
            }
          : {})}
      />
      <ToolbarActions>
        <div className="flex items-center gap-1" data-slot="editor-actions">
          {activeId ? <VideoSwitcher videos={videos} activeId={activeId} onPick={onPickVideo} /> : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" icon={VERB_ICONS.more}>{t`More`}</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={!timeline}
                onSelect={() => toggle('look')}
              >{t`Look`}</DropdownMenuItem>
              <DropdownMenuItem
                disabled={!activeId}
                onSelect={() => toggle('versions')}
              >{t`Versions`}</DropdownMenuItem>
              <DropdownMenuItem
                disabled={!timeline}
                onSelect={() => toggle('comments')}
              >{t`Comments`}</DropdownMenuItem>
              <DropdownMenuItem
                disabled={!cleanupAvailable(timeline)}
                onSelect={() => toggle('cleanup')}
              >{t`Clean up speech`}</DropdownMenuItem>
              <DropdownMenuItem
                disabled={!timeline}
                onSelect={() => toggle('files')}
              >{t`Graphics files`}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {hideExport ? null : (
            <Button
              size="sm"
              variant="primary"
              disabled={!canExport}
              data-slot="export"
              icon={VERB_ICONS.export}
              onClick={onExport}
            >
              {t`Export…`}
            </Button>
          )}
        </div>
      </ToolbarActions>
    </>
  );
}
