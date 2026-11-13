// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · page: UI kit · system: DESIGN.md v0.6 + UX4 · every component in its states, in both themes; the
 * page is built from the anatomy it shows (each gallery a divided, icon-led PageSection) */

import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { ok } from '@taalcut/core';
import {
  AiMark,
  Badge,
  Button,
  CallChip,
  CARD_FIXTURES,
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Chip,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  ChatMessage,
  CONCEPT_ICONS,
  ErrorLine,
  RunBlock,
  ScrollArea,
  StatusMark,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toolGroupFixture,
  MascotPreview,
  ThemeScenePreview,
  WindowBarPreview,
  WindowControlsPreview,
} from '@taalcut/ui';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Ellipsis, Trash2 } from 'lucide-react';
import { LimitCardsGallery } from '../../../chat/limit-cards-gallery';
import { Phase3CardsGallery } from '../../../chat/phase3-cards-gallery';
import { MakeCardsGallery } from '../../../features/make/make-kit';
import { MemoryCardsGallery } from '../../../features/settings/memory/memory-cards-gallery';
import { StyleProfileCardsGallery } from '../../../features/templates/profiles/style-profile-cards-gallery';
import {
  EmptyStateGallery,
  ListRowGallery,
  PageSectionGallery,
  ViewLinksGallery,
} from '../../../features/kit-gallery/anatomy-gallery';
import {
  ButtonsGallery,
  ChoicesGallery,
  FieldsGallery,
} from '../../../features/kit-gallery/controls-gallery';
import { KitSection, KitState } from '../../../features/kit-gallery/kit-parts';
import { IconsGallery, MotionGallery } from '../../../features/kit-gallery/motion-gallery';
import { Page } from '../../../shell/page';

/* Sample chat text and file names: data as written, never translated. */
const SAMPLE_ASK = 'Cut a 30 second reel from my latest clips, on the beat';
const SAMPLE_ANSWER = 'I picked twelve clips and cut them to the beat of your song. The opening shot is';
const SAMPLE_FILE = 'IMG_0412.MOV';
const SAMPLE_FOLDER = 'Desktop/Trip';
/** Eleven clips inspected at once (FIX-TOOLGROUPS): one row each way it can be. The running one started just now. */
const groups = (now: number) => ({
  running: toolGroupFixture('running', undefined, now - 1_200),
  done: toolGroupFixture('done'),
  partlyFailed: toolGroupFixture('partlyFailed'),
});

export const Route = createFileRoute('/_shell/dev/kit')({
  component: Kit,
});

/** The UI kit in both themes and the pseudo-locale (DESIGN.md's preview, built from the real components). */
function Kit() {
  const { t, i18n } = useLingui();
  const [toolGroups] = useState(() => groups(Date.now()));
  return (
    <Page
      title={t`UI kit`}
      description={<Trans>Every component in its states, built from the design tokens.</Trans>}
    >
      <ButtonsGallery />
      <ChoicesGallery />
      <FieldsGallery />
      <ViewLinksGallery />
      <PageSectionGallery />
      <ListRowGallery />
      <EmptyStateGallery />
      <MotionGallery />
      <IconsGallery />

      <KitSection title={t`Window`} icon={CONCEPT_ICONS.thisComputer}>
        <div className="flex flex-col gap-6">
          <WindowControlsPreview />
          <WindowBarPreview />
        </div>
      </KitSection>

      <KitSection title={t`Theme toggle and the day/night scene`} icon={CONCEPT_ICONS.appearance}>
        <ThemeScenePreview />
      </KitSection>

      <KitSection title={t`Kaatu`} icon={CONCEPT_ICONS.about}>
        <MascotPreview />
      </KitSection>

      <KitSection title={t`Chips and badges`} icon={CONCEPT_ICONS.beat}>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="ai">
            <AiMark />
            <Trans>AI pick</Trans>
          </Chip>
          <Chip tone="you">
            <Trans>You changed this</Trans>
          </Chip>
          <Chip tone="beat">
            <Plural value={12} one="# slot" other="# slots" />
          </Chip>
          <Chip tone="primary">
            <Trans>Rendering</Trans>
          </Chip>
          <Badge>
            <Trans>Slot 3</Trans>
          </Badge>
          <Badge tone="success">
            <Trans>Ready</Trans>
          </Badge>
          <Badge tone="warning">
            <Trans>Check this</Trans>
          </Badge>
          <Badge tone="danger">
            <Trans>Failed</Trans>
          </Badge>
          <Badge tone="info">
            <Trans>Cloud</Trans>
          </Badge>
        </div>
      </KitSection>

      <KitSection title={t`Chat`} icon={CONCEPT_ICONS.chat}>
        <div className="flex max-w-2xl flex-col gap-5">
          <ChatMessage role="user" text={SAMPLE_ASK} />
          <RunBlock
            plan={CARD_FIXTURES.plan.running!}
            tools={[
              { card: CARD_FIXTURES.toolRun.succeeded!, stepId: 's1' },
              { card: { ...CARD_FIXTURES.toolRun.running!, id: 'tool-live' }, stepId: 's2' },
            ]}
          />
          <ChatMessage role="agent" text={SAMPLE_ANSWER} streaming />
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-4">
          <KitState label={t`Not started`}>
            <StatusMark status="pending" />
          </KitState>
          <KitState label={t`In progress`}>
            <StatusMark status="running" progress={0.4} />
          </KitState>
          <KitState label={t`Done`}>
            <StatusMark status="done" />
          </KitState>
          <KitState label={t`Failed`}>
            <StatusMark status="failed" />
          </KitState>
          <KitState label={t`Skipped`}>
            <StatusMark status="skipped" />
          </KitState>
        </div>
        <div className="flex flex-col items-start gap-3">
          <CallChip name={t`Check the video`} argument={SAMPLE_FILE} status="running" />
          <CallChip name={t`Add a folder`} argument={SAMPLE_FOLDER} status="succeeded" />
          <CallChip name={t`Look at a frame`} status="failed" onRetry={() => undefined} />
          <CallChip name={t`Look at a frame`} status="cancelled" />
          <ErrorLine error={CARD_FIXTURES.error.withFix!.error} onFix={() => ok(undefined)} />
        </div>
        <div data-slot="kit-tool-groups" className="flex max-w-2xl flex-col gap-5">
          <KitState label={t`Calls to one tool, running`}>
            <RunBlock tools={toolGroups.running} />
          </KitState>
          <KitState label={t`Calls to one tool, done`}>
            <RunBlock tools={toolGroups.done} />
          </KitState>
          <KitState label={t`Calls to one tool, some failed`}>
            <RunBlock tools={toolGroups.partlyFailed} />
          </KitState>
        </div>
      </KitSection>

      <KitSection title={t`Cards, tabs and overlays`} icon={CONCEPT_ICONS.effect}>
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>
                <Trans>Cast board</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>Each slot with the clip the agent picked.</Trans>
              </CardDescription>
            </CardHeader>
            <Tabs defaultValue="slots">
              <TabsList>
                <TabsTrigger value="slots">{t`Slots`}</TabsTrigger>
                <TabsTrigger value="beats">{t`Beats`}</TabsTrigger>
              </TabsList>
              <TabsContent value="slots" className="type-body text-ink-2">
                <Trans>Slot 1 opens on the widest shot.</Trans>
              </TabsContent>
              <TabsContent value="beats" className="type-body text-ink-2">
                <Trans>Cuts land on every second beat.</Trans>
              </TabsContent>
            </Tabs>
            <CardFooter>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="destructive">
                    <Trash2 aria-hidden />
                    <Trans>Delete project</Trans>
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>
                      <Trans>Delete this project?</Trans>
                    </DialogTitle>
                    <DialogDescription>
                      <Trans>The timeline and its renders go. Your clips stay in the library.</Trans>
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant="ghost">
                        <Trans>Keep it</Trans>
                      </Button>
                    </DialogClose>
                    <Button variant="destructive">
                      <Trans>Delete project</Trans>
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={t`More actions`}>
                    <Ellipsis aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>{t`Project`}</DropdownMenuLabel>
                  <DropdownMenuItem>
                    {t`Rename`}
                    <DropdownMenuShortcut>⌘R</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem>{t`Duplicate`}</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive">{t`Delete project`}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </CardFooter>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>
                <Trans>Scroll area</Trans>
              </CardTitle>
            </CardHeader>
            <ScrollArea className="h-40 rounded-md border border-rule-subtle bg-well p-3" tabIndex={0}>
              <ol className="m-0 flex flex-col gap-2 pl-5 type-body text-ink-2">
                {Array.from({ length: 12 }, (_, i) => {
                  const slot = i18n.number(i + 1);
                  return (
                    <li key={slot}>
                      <Trans>Slot {slot}: picked by the agent</Trans>
                    </li>
                  );
                })}
              </ol>
            </ScrollArea>
          </Card>
        </div>
      </KitSection>

      <KitSection title={t`Make cards`} icon={CONCEPT_ICONS.make}>
        <MakeCardsGallery />
      </KitSection>

      <KitSection title={t`Rate limits, external agents and the phone`} icon={CONCEPT_ICONS.usage}>
        <LimitCardsGallery />
      </KitSection>

      <KitSection title={t`Variants, gaps, looks, voice and the hub`} icon={CONCEPT_ICONS.hub}>
        <Phase3CardsGallery />
      </KitSection>

      <KitSection title={t`Memory`} icon={CONCEPT_ICONS.memory}>
        <MemoryCardsGallery />
      </KitSection>

      <KitSection title={t`Style profiles`} icon={CONCEPT_ICONS.template}>
        <StyleProfileCardsGallery />
      </KitSection>
    </Page>
  );
}
