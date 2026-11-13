// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** AGT2 eyes: what the eyes tools read from the app (the agent process's composition root wires them). */
import type { RenderStore, SubjectSource, TemplateId } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import type { TemplateReader } from '@taalcut/timeline';
import type { AssetFiles, TimelineAccess } from '../ports';
import type { FootagePictures } from './pictures';
import type { JudgeSlot } from './slot-judge';

export interface EyesDeps {
  readonly timelines: Pick<TimelineAccess, 'get' | 'atRevision'>;
  readonly templates: Pick<TemplateReader, 'read'>;
  readonly renders: Pick<RenderStore, 'list' | 'get'>;
  /** The template's kept reel on disk (REF1), or null when it keeps none. */
  readonly reel: (templateId: TemplateId) => Promise<string | null>;
  /** The app's FFmpeg, or null where it can't run (the words still come back). */
  readonly media: () => Promise<MediaContext | null>;
  /** A folder of Taalcut's own for the stills while FFmpeg lays them out; nothing is left in it. */
  readonly scratch: string;
  /** Library originals on disk, for library.frameAt. */
  readonly assets: Pick<AssetFiles, 'original'>;
  /** FRM1's subject tracks, for library.subjects. */
  readonly subjects: SubjectSource;
  /** Whether the person's frames go to the run's model as pictures. Absent: never. */
  readonly pictures?: FootagePictures;
  /** video.compare's judge: a model that sees images. Absent: judge says it can't. */
  readonly judge?: JudgeSlot;
}
