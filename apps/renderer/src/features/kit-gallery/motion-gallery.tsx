// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · page part: the motion grammar, to try (UX4) · system: DESIGN.md v0.6 + UX4
 * each motion the kit owns, behind a control that plays it: the tabs' glide, a count ticking, a region opening, a
 *   list arriving (capped stagger), a popover's pop and a toast; and the icon registry, every concept and verb at
 *   its size. Under reduced motion each plays its fade, or happens at once. */
import { useLingui } from '@lingui/react/macro';
import {
  ArrivalItem,
  ArrivalList,
  Button,
  Collapse,
  CONCEPT_ICONS,
  Glyph,
  NumberTicker,
  Popover,
  PopoverContent,
  PopoverTrigger,
  StaleContent,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  VERB_ICONS,
  type IconComponent,
} from '@taalcut/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { KitPart, KitSection } from './kit-parts';

function TickerDemo() {
  const { t } = useLingui();
  const [count, setCount] = useState(12);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="type-section text-ink">
        <NumberTicker value={count} />
      </span>
      <Button size="sm" icon={VERB_ICONS.add} onClick={() => setCount((n) => n + 37)}>
        {t`Add clips`}
      </Button>
      <Button size="sm" variant="ghost" icon={VERB_ICONS.undo} onClick={() => setCount(12)}>
        {t`Reset`}
      </Button>
    </div>
  );
}

/** The last answer stays readable while the next one loads, dimmed after 150 ms; it never blanks. */
function StaleDemo() {
  const { t } = useLingui();
  const [clips, setClips] = useState(48);
  const [stale, setStale] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const load = () => {
    setStale(true);
    timer.current = window.setTimeout(() => {
      setClips((n) => (n === 48 ? 131 : 48));
      setStale(false);
    }, 1200);
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <StaleContent stale={stale} asChild>
        <p className="m-0 type-body text-ink">{t`${clips} clips this month`}</p>
      </StaleContent>
      <Button size="sm" variant="ghost" icon={CONCEPT_ICONS.date} onClick={load} disabled={stale}>
        {t`Another month`}
      </Button>
    </div>
  );
}

function CollapseDemo() {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="flex max-w-md flex-col">
      <Button
        size="sm"
        variant="ghost"
        className="self-start"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((was) => !was)}
      >
        {open ? t`Fewer options` : t`More options`}
      </Button>
      <Collapse open={open} id={id}>
        <p className="m-0 pt-2 type-body text-ink-2">
          {t`What is under this region moves with it as it opens, instead of jumping.`}
        </p>
      </Collapse>
      <p className="m-0 pt-2 type-meta text-ink-3">{t`This line follows the region.`}</p>
    </div>
  );
}

function ArrivalDemo() {
  const { t } = useLingui();
  const [round, setRound] = useState(0);
  const words = [t`Analysing clips`, t`Finding the beats`, t`Casting the slots`, t`Cutting to the beat`];
  return (
    <div className="flex flex-col items-start gap-3">
      <Button size="sm" icon={VERB_ICONS.play} onClick={() => setRound((n) => n + 1)}>
        {t`Play the arrival`}
      </Button>
      <ArrivalList key={round} animate={round > 0} className="m-0 flex list-none flex-col gap-1.5 p-0">
        {words.map((word, index) => (
          <ArrivalItem key={word} index={index} className="type-body text-ink">
            {word}
          </ArrivalItem>
        ))}
      </ArrivalList>
    </div>
  );
}

export function MotionGallery() {
  const { t } = useLingui();
  const [sounds, setSounds] = useState(false);
  return (
    <KitSection
      title={t`Motion`}
      icon={VERB_ICONS.play}
      description={t`Motion carries state: a press gives, a thumb glides, a count ticks, a list arrives. Try each one.`}
    >
      <KitPart title={t`Tabs that glide`}>
        <Tabs defaultValue="slots">
          <TabsList>
            <TabsTrigger value="slots">
              <Glyph icon={CONCEPT_ICONS.slot} />
              {t`Slots`}
            </TabsTrigger>
            <TabsTrigger value="beats">
              <Glyph icon={CONCEPT_ICONS.beat} />
              {t`Beats`}
            </TabsTrigger>
            <TabsTrigger value="pacing">{t`Pacing`}</TabsTrigger>
            <TabsTrigger value="later" disabled>
              {t`Versions`}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="slots" className="type-body text-ink-2">
            {t`Slot 1 opens on the widest shot.`}
          </TabsContent>
          <TabsContent value="beats" className="type-body text-ink-2">
            {t`Cuts land on every second beat.`}
          </TabsContent>
          <TabsContent value="pacing" className="type-body text-ink-2">
            {t`Quick at the start, calmer at the end.`}
          </TabsContent>
        </Tabs>
      </KitPart>
      <KitPart title={t`A count that changes`}>
        <TickerDemo />
      </KitPart>
      <KitPart title={t`Stale while the next answer loads`}>
        <StaleDemo />
      </KitPart>
      <KitPart title={t`Open and close`}>
        <CollapseDemo />
      </KitPart>
      <KitPart title={t`A list arriving`}>
        <ArrivalDemo />
      </KitPart>
      <KitPart title={t`Popover and toast`}>
        <div className="flex flex-wrap items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" icon={CONCEPT_ICONS.memory}>
                {t`Memory scope`}
              </Button>
            </PopoverTrigger>
            <PopoverContent aria-label={t`Memory scope`}>
              <p className="m-0 type-meta text-ink-2">{t`What Taalcut remembers from this chat.`}</p>
              <Switch checked={sounds} onCheckedChange={setSounds} label={t`Remember for every chat`} />
            </PopoverContent>
          </Popover>
          <Button
            size="sm"
            variant="ghost"
            icon={CONCEPT_ICONS.info}
            onClick={() => toast({ title: t`Export finished`, description: t`Golden hour market is ready.` })}
          >
            {t`Show a toast`}
          </Button>
        </div>
      </KitPart>
    </KitSection>
  );
}

function GlyphGrid({ icons }: { icons: Readonly<Record<string, IconComponent>> }) {
  return (
    <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-4 gap-y-2 p-0">
      {Object.entries(icons).map(([name, icon]) => (
        <li key={name} className="flex items-center gap-2 type-meta text-ink-2">
          <Glyph icon={icon} className="text-ink" />
          <code className="type-data" translate="no">
            {name}
          </code>
        </li>
      ))}
    </ul>
  );
}

export function IconsGallery() {
  const { t } = useLingui();
  return (
    <KitSection
      title={t`Icons`}
      icon={CONCEPT_ICONS.image}
      description={t`One glyph per thing and per action, at 14, 16 or 20 px. Pick from here, never by taste.`}
    >
      <div className="flex items-end gap-4 text-ink">
        <Glyph icon={CONCEPT_ICONS.clip} size="sm" />
        <Glyph icon={CONCEPT_ICONS.clip} size="md" />
        <Glyph icon={CONCEPT_ICONS.clip} size="lg" />
      </div>
      <KitPart title={t`Things`}>
        <GlyphGrid icons={CONCEPT_ICONS} />
      </KitPart>
      <KitPart title={t`Actions`}>
        <GlyphGrid icons={VERB_ICONS} />
      </KitPart>
    </KitSection>
  );
}
