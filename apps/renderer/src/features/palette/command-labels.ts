// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * English for the bus commands' label keys ('commands.<name>', core's
 * defineCommand default), used for "Undo …" and for any command the palette
 * has no preset for. Explicit ids: the bus names them.
 */
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';

export const COMMAND_LABELS: readonly MessageDescriptor[] = [
  msg({ id: 'commands.settings.setTheme', message: 'Change the theme' }),
  msg({ id: 'commands.models.setProfile', message: 'Change how Taalcut thinks' }),
  msg({ id: 'commands.models.setModuleOverride', message: 'Choose a model for a job' }),
  msg({ id: 'commands.models.clearModuleOverride', message: 'Reset a job’s model' }),
  msg({ id: 'commands.models.useRecommended', message: 'Use the recommended models' }),
  msg({ id: 'commands.models.restore', message: 'Restore model settings' }),
  msg({ id: 'commands.template.slot.rename', message: 'Rename a slot' }),
  msg({ id: 'commands.template.slot.merge', message: 'Merge slots' }),
  msg({ id: 'commands.template.slot.drop', message: 'Drop a slot' }),
  msg({ id: 'commands.template.slot.approve', message: 'Approve slots' }),
  msg({ id: 'commands.template.setHead', message: 'Go back a template version' }),
  msg({ id: 'commands.library.addSource', message: 'Add a folder' }),
  msg({ id: 'commands.library.removeSource', message: 'Remove a folder' }),
  msg({ id: 'commands.project.setBudgetCap', message: 'Change a project’s budget' }),
  msg({ id: 'commands.budget.setDefaultCap', message: 'Change the budget for new projects' }),
  msg({ id: 'commands.privacy.setLocalOnly', message: 'Turn Local only on or off' }),
  msg({ id: 'commands.privacy.setTelemetry', message: 'Share usage counts, or stop' }),
  msg({ id: 'commands.privacy.setCrashReports', message: 'Send crash reports, or stop' }),
  msg({ id: 'commands.onboarding.setProgress', message: 'Save where first run is' }),
  // UX2-DOWNLOADER: every model this Mac needs is one download; ⌘K starts, pauses, resumes and cancels it.
  msg({ id: 'commands.components.download', message: 'Download everything this Mac needs' }),
  msg({ id: 'commands.components.pauseDownloads', message: 'Pause downloads' }),
  msg({ id: 'commands.components.resumeDownloads', message: 'Resume downloads' }),
  msg({ id: 'commands.components.cancelDownloads', message: 'Cancel downloads' }),
  msg({ id: 'commands.system.openStorage', message: 'Open Storage in System Settings' }),
  // LRN1-STY: the Librarian makes a project like a set of references ("Undo Make it in that style").
  msg({ id: 'commands.styleProfile.use', message: 'Make it in that style' }),
  // P3-IG1: Instagram Saved. ⌘K syncs; watching and linking undo as these ("Undo Watch a Saved collection, or stop").
  msg({ id: 'commands.instagramSaved.syncCollection', message: 'Sync your Saved reels from Instagram' }),
  msg({ id: 'commands.instagramSaved.setWatch', message: 'Watch a Saved collection, or stop' }),
  msg({ id: 'commands.instagramSaved.linkTemplate', message: 'Link a Saved reel to its template' }),
  // LRN1-MEM: Settings › Memory's Add, Edit and Delete, as Undo and Redo name them.
  msg({ id: 'commands.memory.create', message: 'Add a memory' }),
  msg({ id: 'commands.memory.update', message: 'Edit a memory' }),
  msg({ id: 'commands.memory.delete', message: 'Delete a memory' }),
  // LIB1-LANG: the languages you speak (Settings › General, first run) and a clip's language, set by hand.
  msg({ id: 'commands.settings.setSpokenLanguages', message: 'Change the languages you speak' }),
  msg({ id: 'commands.library.setAssetLanguage', message: 'Change a clip’s language' }),
  // EDT1-CMT: comments in the editor, as Undo and Redo name them.
  msg({ id: 'commands.comments.add', message: 'Add a comment' }),
  msg({ id: 'commands.comments.edit', message: 'Edit a comment' }),
  msg({ id: 'commands.comments.remove', message: 'Remove a comment' }),
  msg({ id: 'commands.comments.setStatus', message: 'Resolve or reopen a comment' }),
  msg({ id: 'commands.comments.send', message: 'Send comments to Taalcut' }),
  msg({ id: 'commands.comments.reply', message: 'Answer a comment' }),
  // HFW1-UI: a design's files, as Undo and Redo name them (the AI writes them; the files viewer restores them).
  msg({ id: 'commands.workspace.writeFiles', message: 'Change a design’s files' }),
  msg({ id: 'commands.workspace.restore', message: 'Restore a design’s files' }),
  // AGT2 sbx: a video, image or sound the AI made in its workspace, kept in the library.
  msg({ id: 'commands.workspace.importMedia', message: 'Keep media the AI made' }),
  msg({ id: 'commands.graphics.placeComposition', message: 'Propose a designed graphic' }),
  msg({ id: 'commands.graphics.setComposition', message: 'Give graphics a new design' }),
];
