// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import type { ImportMethod, ImportSession, ImportItemOutcome } from '@taalcut/core';
import { notFound } from '@tanstack/react-router';
import { Cable, Camera, Files, Folder, Images, Smartphone, HardDrive } from 'lucide-react';

export const METHOD_NAMES: Record<ImportMethod, MessageDescriptor> = {
  files: msg`Files`,
  folder: msg`Folder`,
  'phone-wifi': msg`Phone over Wi-Fi`,
  'phone-cable': msg`Phone on a cable`,
  camera: msg`Camera or card`,
  dji: msg`DJI`,
  insta360: msg`Insta360`,
  photos: msg`Apple Photos`,
};
export const METHOD_NOTES: Record<ImportMethod, MessageDescriptor> = {
  files: msg`Choose videos and photos from this computer.`,
  folder: msg`Bring in a folder once, or watch it for new footage.`,
  'phone-wifi': msg`Scan a code, then choose footage on your phone.`,
  'phone-cable': msg`Connect a phone and choose its originals.`,
  camera: msg`Read footage from a mounted camera, drive or card.`,
  dji: msg`Pocket and Action originals over USB storage or a card reader.`,
  insta360: msg`Save originals and companions; playable MP4 is ready to edit.`,
  photos: msg`Choose originals from your System Photo Library. Photos edits are not included.`,
};
export const METHOD_ICONS = {
  files: Files,
  folder: Folder,
  'phone-wifi': Smartphone,
  'phone-cable': Cable,
  camera: Camera,
  dji: Camera,
  insta360: HardDrive,
  photos: Images,
};
export function routeMethod(value: string): ImportMethod {
  if (!Object.hasOwn(METHOD_NAMES, value)) throw notFound();
  return value as ImportMethod;
}
export const SESSION_NAMES: Record<ImportSession['status'], MessageDescriptor> = {
  running: msg`In progress`,
  paused: msg`Paused`,
  interrupted: msg`Needs attention`,
  completed: msg`Completed`,
  partial: msg`Some files need attention`,
  cancelled: msg`Cancelled`,
  failed: msg`Failed`,
};
export const STAGE_NAMES: Record<ImportSession['stage'], MessageDescriptor> = {
  receiving: msg`Receiving or copying`,
  checking: msg`Checking the copy`,
  available: msg`Available to edit`,
  searchable: msg`Searchable`,
  analysed: msg`Fully analysed`,
};
export const OUTCOME_NAMES: Record<ImportItemOutcome['state'], MessageDescriptor> = {
  pending: msg`Waiting`,
  receiving: msg`Receiving`,
  checking: msg`Checking`,
  imported: msg`Imported`,
  duplicate: msg`Already in your library`,
  archived: msg`Originals saved`,
  failed: msg`Needs attention`,
  cancelled: msg`Not imported`,
};
export function bytes(value: number, locale: string): string {
  const unit = value >= 1_000_000_000 ? 'gigabyte' : value >= 1_000_000 ? 'megabyte' : 'kilobyte';
  const divisor = unit === 'gigabyte' ? 1_000_000_000 : unit === 'megabyte' ? 1_000_000 : 1_000;
  return new Intl.NumberFormat(locale, { style: 'unit', unit, maximumFractionDigits: 1 }).format(
    value / divisor,
  );
}

export const IMPORT_WARNINGS: Record<string, MessageDescriptor> = {
  'vendor-processing-required': msg`These originals need vendor processing before they can be edited.`,
  'processing-unapplied': msg`Vendor stabilization or mode processing has not been applied.`,
  'capture-layout-unverified': msg`This capture’s file layout has not been verified. Keep every original together.`,
  'incomplete-capture': msg`Required originals are missing. The capture will stay incomplete until they are restored.`,
  'source-changed': msg`The source changed since you selected it. Choose the footage again.`,
  'source-reconnect-required': msg`Reconnect and check the selected originals when you start importing.`,
  'reference-removable': msg`This removable drive must stay connected when using footage kept in place.`,
  'cloud-local-only': msg`Local only mode prevents downloading cloud originals.`,
  'photos-originals-only': msg`Photos edits are not included. Original files and Photos metadata are kept separately.`,
  'photos-local-only': msg`Only originals already on this Mac can be read unless you allow selected iCloud downloads.`,
  'photos-permission': msg`Allow Photos access in System Settings, then connect again.`,
  'photos-missing-companion': msg`A required Photos resource is missing. Keep the capture together and retry.`,
  'photos-unknown-size': msg`Photos does not expose original sizes. Taalcut checks space while downloading.`,
  'unsupported-format': msg`This file cannot be edited directly. Check whether it can be preserved as an original capture.`,
  'insufficient-space': msg`There is not enough destination space. Free space before importing.`,
};
