// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the media cards take from the app on CardActions and CardData: the microphone for a voice consent, a
 * follow-up to the run for what costs money, Undo in the card's project, a preview that plays from a frame, an
 * artifact's URL, and whether Motion design is on. Each is optional, so a card without one leaves its control out (the kit's rule for missing
 * actions).
 */
import { useCardActions, type CardActions } from '../cards/card-actions';
import { useCardData, type CardData } from '../cards/card-data';

export type {
  CardVoiceCapture,
  CardVoiceRecording,
  MicrophonePermission,
  PreviewPlayFrom,
} from './media-types';

/** The media cards' CardActions members (P3-B6, P3-B7), as CardActions declares them. */
export type MediaCardActions = Pick<CardActions, 'voiceCapture' | 'followUp' | 'undo'>;

/** The media cards' CardData members (P3-B6, P3-V13, UX2-GSAP), as CardDataPhase3 declares them. */
export type MediaCardData = Pick<CardData, 'renderPreviewFrom' | 'artifactUrl'>;

export function useMediaActions(): CardActions & MediaCardActions {
  const actions: CardActions & MediaCardActions = useCardActions();
  return actions;
}

export function useMediaData(): CardData & MediaCardData {
  const data: CardData & MediaCardData = useCardData();
  return data;
}
