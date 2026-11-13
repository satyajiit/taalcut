// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Settings' sentences that name the Mac, and their words on every other computer (UX3-MAC; the kit's
 * platform-words.ts says how a pair works): About, Models and the keys the models package sends, Memory, Sources,
 * Plugins, External agents, Help, and the settings' error keys. Privacy and Usage have their own table.
 */
import { msg } from '@lingui/core/macro';
import { macKey, type PlatformWords } from '@taalcut/ui';

export const SETTINGS_PLATFORM_WORDS: readonly PlatformWords[] = [
  // About.
  {
    mac: msg`Clips are described on this Mac, and a model on this Mac can stand in for the agent.`,
    computer: msg`Clips are described on this computer, and a model on this computer can stand in for the agent.`,
  },
  {
    mac: msg`Everything can run on this Mac, including the larger models.`,
    computer: msg`Everything can run on this computer, including the larger models.`,
  },
  {
    mac: msg`Tools and models Taalcut downloaded to run on this Mac.`,
    computer: msg`Tools and models Taalcut downloaded to run on this computer.`,
  },
  { mac: msg`This Mac’s details didn’t load.`, computer: msg`This computer’s details didn’t load.` },
  { mac: msg`Where work runs on this Mac`, computer: msg`Where work runs on this computer` },
  {
    mac: msg`Match the Mac follows your Mac’s light or dark setting as it changes. The sun or moon at the foot of the sidebar flips between light and dark.`,
    computer: msg`Match the system follows your system’s light or dark setting as it changes. The sun or moon at the foot of the sidebar flips between light and dark.`,
  },
  {
    mac: msg`First run again: how Taalcut thinks, this Mac, your videos. Your projects, clips and settings stay as they are.`,
    computer: msg`First run again: how Taalcut thinks, this computer, your videos. Your projects, clips and settings stay as they are.`,
  },

  // Models: the profile and module words, and the keys the models package sends.
  {
    mac: macKey('models.profile.local-only.label'),
    computer: msg({ id: 'models.profile.local-only.label.computer', message: 'On this computer' }),
  },
  {
    mac: macKey('models.profile.local-only.description'),
    computer: msg({
      id: 'models.profile.local-only.description.computer',
      message: 'Every job uses the models on this computer. Lower quality, and no AI voice or images.',
    }),
  },
  {
    mac: macKey('models.module.embeddings.description'),
    computer: msg({
      id: 'models.module.embeddings.description.computer',
      message: 'Finds clips that match what a moment needs. Always runs on this computer.',
    }),
  },
  {
    mac: macKey('errors.models.hardware_probe_failed'),
    computer: msg({
      id: 'errors.models.hardware_probe_failed.computer',
      message: 'Couldn’t read this computer’s hardware.',
    }),
  },
  {
    mac: macKey('models.compute.cpuReason.hardware_lacks_backend'),
    computer: msg({
      id: 'models.compute.cpuReason.hardware_lacks_backend.computer',
      message: 'This computer has no GPU this model can use.',
    }),
  },
  { mac: msg`On this Mac`, computer: msg`On this computer` },
  { mac: msg`on this Mac`, computer: msg`on this computer` },
  { mac: msg`Recommended for this Mac`, computer: msg`Recommended for this computer` },
  { mac: msg`needs a faster Mac`, computer: msg`needs a faster computer` },
  {
    mac: msg({ message: 'Skipped <0>{skippedName}</0>: it needs a faster Mac.' }),
    computer: msg({ message: 'Skipped <0>{skippedName}</0>: it needs a faster computer.' }),
  },
  {
    mac: msg`This isn’t the setup Taalcut recommends for this Mac.`,
    computer: msg`This isn’t the setup Taalcut recommends for this computer.`,
  },
  {
    mac: msg({ message: 'Local only is on in {privacy}, and On this Mac runs each job on this Mac.' }),
    computer: msg({
      message: 'Local only is on in {privacy}, and On this computer runs each job on this computer.',
    }),
  },
  {
    mac: msg({
      message:
        'Local only is on in {privacy}, so the jobs this profile sends to the cloud are off. Choose On this Mac to run them here.',
    }),
    computer: msg({
      message:
        'Local only is on in {privacy}, so the jobs this profile sends to the cloud are off. Choose On this computer to run them here.',
    }),
  },
  {
    mac: msg`Local only is on, so these jobs work differently on this Mac:`,
    computer: msg`Local only is on, so these jobs work differently on this computer:`,
  },

  // Memory.
  {
    mac: msg`Local only is on, so the agent works on this Mac and your memory never leaves it.`,
    computer: msg`Local only is on, so the agent works on this computer and your memory never leaves it.`,
  },
  {
    mac: msg`The agent works on this Mac, so your memory never leaves it.`,
    computer: msg`The agent works on this computer, so your memory never leaves it.`,
  },
  {
    mac: msg({
      message:
        'Your memory goes with each request the agent sends to {names}. Turn this off to keep it on this Mac.',
    }),
    computer: msg({
      message:
        'Your memory goes with each request the agent sends to {names}. Turn this off to keep it on this computer.',
    }),
  },

  // Sources and Plugins.
  { mac: msg`Folders on this Mac`, computer: msg`Folders on this computer` },
  {
    mac: msg`Clips you sent from your phone over Wi-Fi or a cable. Taalcut keeps a copy in its own folder on this Mac.`,
    computer: msg`Clips you sent from your phone over Wi-Fi or a cable. Taalcut keeps a copy in its own folder on this computer.`,
  },
  {
    mac: msg`Copy the credential, then import it. It is stored securely on this Mac and never shown to the AI.`,
    computer: msg`Copy the credential, then import it. It is stored securely on this computer and never shown to the AI.`,
  },

  // External agents.
  { mac: msg`Agents on this Mac`, computer: msg`Agents on this computer` },
  { mac: msg`Let agents on this Mac use Taalcut`, computer: msg`Let agents on this computer use Taalcut` },
  {
    mac: msg({ message: 'Listening on this Mac only, at <0>{url}</0>' }),
    computer: msg({ message: 'Listening on this computer only, at <0>{url}</0>' }),
  },
  {
    mac: msg`Copy HTTP setup suits a Mac with one user account: while Taalcut is closed, another account on this Mac could answer in its place and collect the key.`,
    computer: msg`Copy HTTP setup suits a computer with one user account: while Taalcut is closed, another account on this computer could answer in its place and collect the key.`,
  },
  {
    mac: msg`Other AI apps on this Mac that can work in Taalcut, and what each may do.`,
    computer: msg`Other AI apps on this computer that can work in Taalcut, and what each may do.`,
  },
  {
    mac: msg`The setup holds a key only this Mac knows. Taalcut keeps it in the keychain and never shows it here.`,
    computer: msg({
      message:
        'The setup holds a key only this computer knows. Taalcut keeps it in the system keyring and never shows it here.',
      comment: 'The keyring is where the system keeps passwords: GNOME Keyring or KWallet on Linux',
    }),
    windows: msg`The setup holds a key only this computer knows. Taalcut keeps it in Windows Credential Manager and never shows it here.`,
  },

  // The settings' error keys (settings-errors.ts).
  {
    mac: macKey('errors.library.folder_missing'),
    computer: msg({
      id: 'errors.library.folder_missing.computer',
      message: 'The {name} folder isn’t on this computer any more. If you moved it, choose it again.',
    }),
  },
  {
    mac: macKey('errors.library.folder_permission_denied'),
    computer: msg({
      id: 'errors.library.folder_permission_denied.computer',
      message:
        'Taalcut isn’t allowed to read {name}. Check that your account can open that folder, then check it again.',
    }),
  },
  {
    mac: macKey('errors.mcp.bind_failed'),
    computer: msg({
      id: 'errors.mcp.bind_failed.computer',
      message:
        'This computer didn’t let Taalcut listen on port {port}. Try again, or restart your computer if it keeps happening.',
    }),
  },
  // Accounts' keys and sign-ins (UX3-AGT's words off a Mac, as pairs).
  {
    mac: msg`A key from a provider’s website lets Taalcut use its models, billed to you by that provider. Keys stay in your Mac’s keychain.`,
    computer: msg`A key from a provider’s website lets Taalcut use its models, billed to you by that provider. Keys stay in your system keyring.`,
    windows: msg`A key from a provider’s website lets Taalcut use its models, billed to you by that provider. Keys stay in Windows Credential Manager.`,
  },
  {
    mac: msg`Kept in your Mac’s keychain. Taalcut never shows it again.`,
    computer: msg`Kept in your system keyring. Taalcut never shows it again.`,
    windows: msg`Kept in Windows Credential Manager. Taalcut never shows it again.`,
  },
  {
    mac: msg({
      message:
        'Taalcut stops using {label} until you add a key again. The key is deleted from your keychain.',
    }),
    computer: msg({
      message:
        'Taalcut stops using {label} until you add a key again. The key is deleted from your system keyring.',
    }),
    windows: msg({
      message:
        'Taalcut stops using {label} until you add a key again. The key is deleted from Windows Credential Manager.',
    }),
  },
  {
    mac: msg`Optional. Taalcut already runs models on this Mac, with nothing to install. If you run Ollama or LM Studio yourself, Taalcut can use its models too.`,
    computer: msg`Optional. Taalcut already runs models on this computer, with nothing to install. If you run Ollama or LM Studio yourself, Taalcut can use its models too.`,
  },
  {
    mac: msg`Sign in to browse the Reels you saved on Instagram and turn them into templates. Your session stays in your Mac’s Keychain.`,
    computer: msg`Sign in to browse the Reels you saved on Instagram and turn them into templates. Your session stays in your system keyring.`,
    windows: msg`Sign in to browse the Reels you saved on Instagram and turn them into templates. Your session stays in Windows Credential Manager.`,
  },
  {
    // The Instagram warning's fallback, where the catalogue lacks the backend's key.
    mac: msg`Taalcut signs in through an Instagram browser window on this Mac and reads your Saved collections with your browser session.`,
    computer: msg`Taalcut signs in through an Instagram browser window on this computer and reads your Saved collections with your browser session.`,
  },
  {
    mac: macKey('errors.models.secret_store_failed'),
    computer: msg({
      id: 'errors.models.secret_store_failed.computer',
      message:
        'Couldn’t reach the system keyring, where Taalcut keeps your keys and sign-ins. Check that it’s unlocked, then try again.',
    }),
    windows: msg({
      id: 'errors.models.secret_store_failed.windows',
      message:
        'Couldn’t reach Windows Credential Manager, where Taalcut keeps your keys and sign-ins. Try again.',
    }),
  },
  {
    mac: macKey('templates.warning.instagram.body'),
    computer: msg({
      id: 'templates.warning.instagram.body.computer',
      message:
        'Taalcut signs in through an Instagram browser window on this computer and reads your Saved collections with your browser session. Your session stays in your system keyring and is never sent anywhere else.',
    }),
    windows: msg({
      id: 'templates.warning.instagram.body.windows',
      message:
        'Taalcut signs in through an Instagram browser window on this computer and reads your Saved collections with your browser session. Your session stays in Windows Credential Manager and is never sent anywhere else.',
    }),
  },
];
