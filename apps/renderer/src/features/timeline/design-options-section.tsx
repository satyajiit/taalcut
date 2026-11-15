// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: design options section (DSG2) · genre: atmospheric studio app (the timeline)
 * system: DESIGN.md v0.3 · in the inspector of a selected graphic that came with designs to choose between: a
 *   small heading and the kit's picker (each design as a still over the person's video, its name and idea, the one
 *   in the video marked). One click swaps another in (graphics.chooseOption, one ⌘Z); the viewer beside it shows
 *   the result. "Three new designs" asks the docked chat, the graphic as a chip.
 * states: default · choosing (that tile busy) · error under the picker · asked (the chat shows it)
 * motion: none · pre-emit critique: P4 H4 E4 S4 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { GraphicItem, ProjectId, SelectionChip, TaalcutError, Timeline } from '@taalcut/core';
import {
  Button,
  canvasAspect,
  CardDataProvider,
  CHOOSE_OPTION,
  DesignOptionPicker,
  MediaError,
  useDesignOptions,
  type CardData,
} from '@taalcut/ui';
import { RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useBackend } from '../../backend/backend';
import { designStillReader } from '../../chat/design-stills';
import { sendInChat } from './dock/chat-requests';
import { useEditorContext } from './editor-context';

export interface DesignOptionsSectionProps {
  readonly item: GraphicItem;
  /** The inspector's command runner: one control busy at a time, errors by the control's key. */
  readonly command: {
    readonly busy: string | null;
    readonly error: { readonly key: string; readonly error: TaalcutError } | null;
    run(key: string, name: string, payload: unknown): Promise<boolean>;
  };
}

const KEY = 'option:';

interface PickerProps extends DesignOptionsSectionProps {
  readonly projectId: ProjectId;
  readonly timeline: Timeline;
}

function Picker({ item, command, projectId, timeline }: PickerProps) {
  const { t } = useLingui();
  const [asked, setAsked] = useState(false);
  // No still of its own leaves a tile on the viewer grey: the viewer beside the inspector shows the graphic.
  const options = useDesignOptions({ projectId, timeline, item, fallback: null });
  const chip: SelectionChip = { kind: 'item', timelineId: timeline.id, itemId: item.id, itemKind: 'graphic' };
  const busy = command.busy?.startsWith(KEY) ? command.busy.slice(KEY.length) : null;
  const failed = command.error?.key.startsWith(KEY) ? command.error.error : null;
  return (
    <section data-slot="design-options-section" className="@container flex flex-col gap-2">
      <h3 className="m-0 type-meta font-semibold text-ink-2">{t`Designs to choose from`}</h3>
      <DesignOptionPicker
        options={options}
        aspect={canvasAspect(timeline)}
        disabled={command.busy !== null && busy === null}
        busy={busy}
        onChoose={(compositionId) =>
          void command.run(`${KEY}${compositionId}`, CHOOSE_OPTION, {
            projectId,
            timelineId: timeline.id,
            itemId: item.id,
            compositionId,
          })
        }
      />
      {failed ? <MediaError error={failed} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={command.busy !== null}
          onClick={() => {
            sendInChat({ text: t`Try again: design this graphic another way.`, selections: [chip] });
            setAsked(true);
          }}
        >
          <RefreshCw aria-hidden />
          {t`Three new designs`}
        </Button>
        {asked ? (
          <p role="status" className="m-0 text-sm text-ink-2">{t`Asked for three new designs.`}</p>
        ) : null}
      </div>
    </section>
  );
}

/** The designs a selected graphic can be switched between; nothing for a graphic with one design or none. */
export function DesignOptionsSection(props: DesignOptionsSectionProps) {
  const backend = useBackend();
  const editor = useEditorContext();
  // The picker reads its stills through CardData, which the inspector sits outside of.
  const data = useMemo<CardData>(() => ({ designStill: designStillReader(backend) }), [backend]);
  // One design is in the video with nothing to choose yet (the others join as they are placed).
  if (!editor || (props.item.options?.designs.length ?? 0) < 2) return null;
  return (
    <CardDataProvider value={data}>
      <Picker {...props} projectId={editor.projectId} timeline={editor.timeline} />
    </CardDataProvider>
  );
}
