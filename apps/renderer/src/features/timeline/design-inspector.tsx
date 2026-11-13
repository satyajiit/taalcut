// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: designed graphic inspector (HFW1-UI) · genre: atmospheric studio app (the timeline)
 * system: DESIGN.md v0.3 · the inspector for a selected graphic the AI designed: its design's name (the model's
 *   words, as content, never a kind) and version; while it is a proposal, the designed proposal row (its name, when
 *   it plays, Use it, Try again, Change…; the viewer beside it plays it); when it shows (Earlier/Later by a frame or
 *   a beat: one graphics.edit each, as a drag on its lane); its words and colours (graphics.edit { params }); then
 *   Change the look… and Move or resize on screen… (the docked chat, the graphic as a chip: the design places and
 *   sizes itself with its CSS, so both are the AI's to design), View files (the dock's Files) and Remove graphic
 * states: default · proposed · each control's eight · busy on the control pressed · error under the control that
 *   failed · Try again sent (the chat shows it) · pre-emit critique: P5 H4 E4 S4 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { GraphicParamValues, SelectionChip } from '@taalcut/core';
import {
  Button,
  DesignProposalRow,
  DesignVariablesForm,
  designOf,
  EDIT_GRAPHIC,
  GraphicTiming,
  MediaError,
  REMOVE_GRAPHIC,
  USE_PROPOSAL,
  UserContent,
  VERB_ICONS,
} from '@taalcut/ui';
import { MessageSquareText, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { selectionStore } from '../../chat/selection-store';
import { sendInChat } from './dock/chat-requests';
import { useEditorContext } from './editor-context';
import type { GraphicView } from './graphics-lane-model';
import type { EditorSelection } from './selection';
import { useKeyedCommand } from './use-keyed-command';
import { useEditorTextFocus } from './use-editor-text-focus';
import { showFiles } from './workspace/files-requests';

export interface DesignInspectorProps {
  readonly view: GraphicView;
  readonly onSelect: (selection: EditorSelection) => void;
}

export function DesignInspector({ view, onSelect }: DesignInspectorProps) {
  const { t, i18n } = useLingui();
  const editor = useEditorContext();
  const command = useKeyedCommand();
  const [asked, setAsked] = useState(false);
  const words = useEditorTextFocus(view.item.id);
  if (!editor) return null;
  const { item } = view;
  const { timeline } = editor;
  const design = designOf(timeline, item);
  const name = design?.name ?? view.design ?? '';
  const rate = editor.model.rate;
  const target = { projectId: editor.projectId, timelineId: timeline.id, itemId: item.id };
  const edit = (key: string, change: object) => command.run(key, EDIT_GRAPHIC, { ...target, ...change });
  const chip: SelectionChip = { kind: 'item', timelineId: timeline.id, itemId: item.id, itemKind: 'graphic' };
  const changeLook = () => selectionStore.askWith(t`Change the look of this graphic: `, [chip]);
  const moveOnScreen = () => selectionStore.askWith(t`Move or resize this graphic on screen: `, [chip]);
  const version = design ? i18n.number(design.version) : '';

  return (
    <div data-slot="graphic-inspector" data-design="" className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 type-card-title text-ink">
          <UserContent translate="no" className="[overflow-wrap:anywhere]">
            {name}
          </UserContent>
        </h2>
        {design ? <p className="m-0 type-meta text-ink-2">{t`Designed graphic · v${version}`}</p> : null}
      </div>
      {item.proposal ? (
        <DesignProposalRow
          name={name}
          start={item.start}
          duration={item.duration}
          disabled={command.busy !== null}
          using={command.busy === 'use'}
          useError={command.error?.key === 'use' ? command.error.error : null}
          onUse={() => void command.run('use', USE_PROPOSAL, target)}
          tryAgain={{
            busy: false,
            sent: asked,
            error: null,
            run: () => {
              sendInChat({ text: t`Try again: design this graphic another way.`, selections: [chip] });
              setAsked(true);
            },
          }}
          onChange={changeLook}
        />
      ) : null}
      {design && item.composition ? (
        <div ref={words}>
          <DesignVariablesForm
            key={item.id}
            variables={design.variables}
            params={item.composition.params}
            disabled={false}
            busy={command.busy}
            error={command.error}
            onSave={(key, params: GraphicParamValues) => edit(key, { params })}
          />
        </div>
      ) : null}
      <GraphicTiming
        start={item.start}
        duration={item.duration}
        beat={editor.model.beatFrames}
        disabled={false}
        busy={command.busy}
        error={command.error}
        onMove={(key, frame) => void edit(key, { anchor: { kind: 'time', at: { value: frame, rate } } })}
      />
      <div className="flex flex-wrap items-center gap-2">
        {item.proposal ? null : (
          <Button size="sm" onClick={changeLook}>
            <MessageSquareText aria-hidden />
            {t`Change the look…`}
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={VERB_ICONS.moveOnScreen} onClick={moveOnScreen}>
          {t`Move or resize on screen…`}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={VERB_ICONS.viewFiles}
          onClick={() => showFiles({ timelineId: timeline.id, itemId: item.id })}
        >
          {t`View files`}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          loading={command.busy === 'remove'}
          onClick={async () => {
            if (await command.run('remove', REMOVE_GRAPHIC, target)) onSelect(null);
          }}
        >
          <Trash2 aria-hidden />
          {t`Remove graphic`}
        </Button>
      </div>
      {command.error?.key === 'remove' ? <MediaError error={command.error.error} /> : null}
    </div>
  );
}
