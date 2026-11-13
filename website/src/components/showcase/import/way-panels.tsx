// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the other ways in, each on its page · mode: Operate · system: WEB2 Remix Vernacular (teal is yours)
 * rebuilt lean from the app's import pages (apps/renderer/src/features/library/imports/import-connect.tsx,
 *   import-review.tsx; phone/connect/cable-tab.tsx), in their words: Files (the drop line, how to keep your footage,
 *   Only new footage); Folder (the owner's Vietnam trip folder, Copy into Taalcut or Keep in place, Include subfolders,
 *   Watch for new footage, which keeps footage in place, as the app does, and shows a new clip landing in the folder);
 *   Apple Photos (originals only, iCloud downloads only if you allow them); Phone on a cable (what an iPhone and an
 *   Android phone ask); Camera or card, DJI and Insta360 (a mounted volume, originals never deleted)
 * states: radios and checkboxes: default, hover, focus (base ring), checked, disabled (Keep in place is the only
 *   storage while a folder is watched) · the watched folder: watching (Watching, a new clip lands) or not · the
 *   cable's phone: iPhone or Android (segmented) · loading/error n/a (nothing is read from a disk here)
 * motion: the new clip drops into the folder and its chip pops (--dur-short, ease-out); reduced motion: it is there */

import { Eye, FolderOpen, Plus } from 'lucide-react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { useId, useState, type ReactNode } from 'react';
import { cn } from '#lib/cn';
import { DUR, EASE_OUT } from '#lib/motion';
import { clipById } from '../auto-pick/roll';
import { Chip } from '../chip';
import { ClipFrame } from '../frame';
import { Segmented } from '../segmented';
import type { WayId } from './ways';

const FADE = { duration: DUR.short, ease: EASE_OUT } as const;

type Storage = 'copy' | 'reference';

function Choice({ checked, disabled, children }: { readonly checked: boolean; readonly disabled?: boolean; readonly children: ReactNode }) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-lg border p-3 type-body transition-colors duration-(--dur-micro) ease-(--ease-out)',
        checked ? 'border-rule-strong bg-selected' : 'border-rule-subtle bg-canvas hover:bg-hover',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      {children}
    </label>
  );
}

function Check({ checked, onChange, children }: { readonly checked: boolean; readonly onChange: (on: boolean) => void; readonly children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 type-body text-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 shrink-0 accent-teal-strong"
      />
      {children}
    </label>
  );
}

/** How to keep your footage: copy it in, or keep it where it is (files and folders); the rest are always copied. */
function Keep({ storage, onStorage, locked }: { readonly storage: Storage; readonly onStorage: (s: Storage) => void; readonly locked: boolean }) {
  const name = useId();
  return (
    <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0" disabled={locked}>
      <legend className="mb-2.5 type-section text-ink">How to keep your footage</legend>
      {(
        [
          ['copy', 'Copy into Taalcut', 'Recommended. Your originals stay where they are.'],
          ['reference', 'Keep in place', 'Use stable local storage. Keep the files and drive available to edit.'],
        ] as const
      ).map(([value, title, note]) => (
        <Choice key={value} checked={storage === value} disabled={locked && storage !== value}>
          <input
            type="radio"
            name={name}
            checked={storage === value}
            onChange={() => onStorage(value)}
            className="mt-1 size-4 shrink-0 accent-teal-strong"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-ink">{title}</span>
            <span className="type-meta text-ink-2">{note}</span>
          </span>
        </Choice>
      ))}
    </fieldset>
  );
}

function Panel({ children }: { readonly children: ReactNode }) {
  return <div className="flex flex-col gap-5 rounded-xl border border-rule-subtle bg-well p-4">{children}</div>;
}

function FilesPanel() {
  const [storage, setStorage] = useState<Storage>('copy');
  const [onlyNew, setOnlyNew] = useState(true);
  return (
    <>
      <p className="m-0 flex items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-rule-strong bg-sunken px-4 py-6 type-label text-ink-2">
        <Plus aria-hidden className="size-4 shrink-0" />
        Drop files or folders to review an import
      </p>
      <Panel>
        <Keep storage={storage} onStorage={setStorage} locked={false} />
        <Check checked={onlyNew} onChange={setOnlyNew}>
          Only new footage
        </Check>
      </Panel>
    </>
  );
}

const FOLDER_CLIPS = ['vietnam-06', 'repeat-09', 'airport-01'] as const;
const NEW_CLIP = 'repeat-05';

function FolderPanel() {
  const [storage, setStorage] = useState<Storage>('copy');
  const [subfolders, setSubfolders] = useState(true);
  const [watch, setWatch] = useState(false);
  const [onlyNew, setOnlyNew] = useState(true);
  const shown = watch ? [...FOLDER_CLIPS, NEW_CLIP] : FOLDER_CLIPS;
  return (
    <>
      <section aria-label="The folder" className="flex flex-col gap-3 rounded-xl border border-rule-subtle bg-raised p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <FolderOpen aria-hidden className="size-4.5 shrink-0 text-teal-strong" />
          <span className="me-auto type-card-title text-ink">Vietnam trip</span>
          <AnimatePresence initial={false}>
            {watch ? (
              <motion.span key="watching" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={FADE}>
                <Chip tone="you">
                  <Eye aria-hidden />
                  Watching for new footage
                </Chip>
              </motion.span>
            ) : null}
          </AnimatePresence>
        </div>
        <ul className="m-0 flex list-none gap-2 p-0">
          <AnimatePresence initial={false}>
            {shown.map((id) => {
              const clip = clipById(id);
              const fresh = id === NEW_CLIP;
              return (
                <motion.li
                  key={id}
                  initial={{ opacity: 0, y: -24, rotate: -6 }}
                  animate={{ opacity: 1, y: 0, rotate: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ ...FADE, delay: fresh ? 0.6 : 0, duration: DUR.long }}
                  className="relative flex w-14 flex-col gap-1"
                >
                  <ClipFrame sprite={clip.sprite} className={cn('w-full rounded-md', fresh && 'ring-2 ring-teal-strong')} />
                  <span className="truncate type-caption text-ink-2">{clip.short}</span>
                  {fresh ? (
                    <span className="absolute -top-2 -right-2 rounded-pill bg-teal px-1.5 py-0.5 type-caption font-semibold text-teal-ink shadow-xs">
                      New
                    </span>
                  ) : null}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      </section>
      <Panel>
        <Keep storage={watch ? 'reference' : storage} onStorage={setStorage} locked={watch} />
        <div className="flex flex-col gap-2.5 border-t border-rule-subtle pt-3">
          <Check checked={subfolders} onChange={setSubfolders}>
            Include subfolders
          </Check>
          <Check checked={watch} onChange={setWatch}>
            Watch for new footage
          </Check>
          <p className="m-0 ps-7 type-meta text-ink-2">
            Watched folders keep footage in place. You can review the initial scan and change its scope.
          </p>
          <Check checked={onlyNew} onChange={setOnlyNew}>
            Only new footage
          </Check>
        </div>
      </Panel>
    </>
  );
}

function PhotosPanel() {
  const [cloud, setCloud] = useState(false);
  return (
    <>
      <p className="m-0 max-w-prose type-body text-ink-2">
        Connect to allow read access. Originals stay in Photos. iCloud downloads are off until you explicitly select a batch and allow them.
      </p>
      <Panel>
        <h4 className="m-0 type-section text-ink">Apple Photos originals</h4>
        <p className="m-0 max-w-prose type-body text-ink-2">
          Photos edits are not included. Photos metadata is kept separately from the original file.
        </p>
        <Check checked={cloud} onChange={setCloud}>
          Download selected originals from iCloud
        </Check>
      </Panel>
    </>
  );
}

const CABLE_PHONES = {
  iphone: ['Unlock your iPhone', 'Unlock it, then tap Trust and enter your passcode.'],
  android: ['Allow file transfer', 'Unlock your phone, tap the USB notification and choose File transfer.'],
} as const;

function CablePanel() {
  const [phone, setPhone] = useState<keyof typeof CABLE_PHONES>('iphone');
  const [title, step] = CABLE_PHONES[phone];
  return (
    <Panel>
      <h4 className="m-0 type-section text-ink">Allow it on the phone</h4>
      <Segmented
        label="Your phone"
        value={phone}
        onChange={setPhone}
        options={[
          { value: 'iphone', label: 'iPhone' },
          { value: 'android', label: 'Android' },
        ]}
      />
      <AnimatePresence initial={false} mode="wait">
        <motion.div key={phone} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={FADE} className="flex flex-col gap-1">
          <p className="m-0 type-card-title text-ink">{title}</p>
          <p className="m-0 max-w-prose type-body text-ink-2">{step}</p>
        </motion.div>
      </AnimatePresence>
      <div className="flex flex-col gap-1 border-t border-rule-subtle pt-3">
        <p className="m-0 type-card-title text-ink">Choose what to bring in</p>
        <p className="m-0 max-w-prose type-body text-ink-2">
          The last 30 days of videos and Live Photos, only what’s new, or choose others.
        </p>
      </div>
    </Panel>
  );
}

function CardPanel({ way }: { readonly way: 'camera' | 'dji' | 'insta360' }) {
  const [onlyNew, setOnlyNew] = useState(true);
  return (
    <>
      {way === 'insta360' ? (
        <p className="m-0 max-w-prose type-body text-ink-2">
          Keep all original lens files and segments together. 360 originals are saved as captures; native stitching and reframing are not included.
        </p>
      ) : null}
      <p className="m-0 max-w-prose type-body text-ink-2">
        Connect a card reader or select USB storage on the camera, then choose its mounted volume. Taalcut never deletes originals.
      </p>
      <Panel>
        <h4 className="m-0 type-section text-ink">How to keep your footage</h4>
        <p className="m-0 type-body text-ink-2">Originals are copied into Taalcut. Nothing is deleted from your source.</p>
        <Check checked={onlyNew} onChange={setOnlyNew}>
          Only new footage
        </Check>
      </Panel>
    </>
  );
}

/** The chosen way's page, apart from Phone over Wi-Fi (wifi-panel.tsx). */
export function WayPanel({ way }: { readonly way: Exclude<WayId, 'phone-wifi'> }) {
  return (
    <MotionConfig reducedMotion="user">
      <div className="flex flex-col gap-4">
        {way === 'files' ? <FilesPanel /> : null}
        {way === 'folder' ? <FolderPanel /> : null}
        {way === 'photos' ? <PhotosPanel /> : null}
        {way === 'phone-cable' ? <CablePanel /> : null}
        {way === 'camera' || way === 'dji' || way === 'insta360' ? <CardPanel way={way} /> : null}
      </div>
    </MotionConfig>
  );
}
