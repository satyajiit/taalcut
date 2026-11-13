// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · page part: the kit's controls in their states (UX4) · system: DESIGN.md v0.6 + UX4
 * Button (the eight states, the verb's icon, the press, a tick when it finishes), Checkbox, Radio, Switch and
 *   Segmented (with their words as part of the hit area), Input and Select */
import { useLingui } from '@lingui/react/macro';
import {
  Button,
  Checkbox,
  CONCEPT_ICONS,
  Input,
  Radio,
  RadioGroup,
  Segmented,
  Select,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VERB_ICONS,
} from '@taalcut/ui';
import { useEffect, useRef, useState } from 'react';
import { KitPart, KitSection, KitState, KitStates, SHOW_FOCUS } from './kit-parts';

const noop = () => undefined;

/** A button that does its work: loading for a moment, then the tick draws itself in. */
function FinishingButton() {
  const { t } = useLingui();
  const [phase, setPhase] = useState<'idle' | 'loading' | 'done'>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const run = () => {
    setPhase('loading');
    timer.current = window.setTimeout(() => {
      setPhase('done');
      timer.current = window.setTimeout(() => setPhase('idle'), 1600);
    }, 900);
  };
  return (
    <Button
      variant="primary"
      icon={VERB_ICONS.export}
      loading={phase === 'loading'}
      status={phase === 'done' ? 'success' : undefined}
      onClick={phase === 'idle' ? run : undefined}
    >
      {phase === 'loading' ? t`Exporting` : phase === 'done' ? t`Exported` : t`Export`}
    </Button>
  );
}

export function ButtonsGallery() {
  const { t } = useLingui();
  return (
    <KitSection
      title={t`Buttons`}
      icon={CONCEPT_ICONS.export}
      description={t`Every verb carries its icon from the registry. A press gives by 2 %; a finished job draws a tick.`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon={VERB_ICONS.export}>
          {t`Export video`}
        </Button>
        <Button icon={VERB_ICONS.swap}>{t`Swap clip`}</Button>
        <Button variant="ghost">{t`Cancel`}</Button>
        <Button variant="destructive" icon={VERB_ICONS.delete}>
          {t`Delete project`}
        </Button>
        <Button size="sm" icon={VERB_ICONS.retry}>
          {t`Try again`}
        </Button>
        <Button size="sm" variant="ghost" icon={VERB_ICONS.open} iconPlacement="end">
          {t`Open`}
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon" aria-label={t`Undo`} icon={VERB_ICONS.undo} />
          </TooltipTrigger>
          <TooltipContent>{t`Undo`}</TooltipContent>
        </Tooltip>
        <FinishingButton />
      </div>
      {/* Columns fit the widest state in every language (Spanish "Exportando" with its spinner). */}
      <KitStates>
        <KitState label={t`Default`}>
          <Button variant="primary" icon={VERB_ICONS.export}>
            {t`Export`}
          </Button>
        </KitState>
        <KitState label={t`Hover`}>
          <Button
            variant="primary"
            icon={VERB_ICONS.export}
            className="bg-primary-strong text-primary-strong-ink"
          >
            {t`Export`}
          </Button>
        </KitState>
        <KitState label={t`Focus`}>
          <Button variant="primary" icon={VERB_ICONS.export} className={SHOW_FOCUS}>
            {t`Export`}
          </Button>
        </KitState>
        <KitState label={t`Active`}>
          <Button
            variant="primary"
            icon={VERB_ICONS.export}
            className="scale-[0.98] bg-primary-strong text-primary-strong-ink"
          >
            {t`Export`}
          </Button>
        </KitState>
        <KitState label={t`Disabled`}>
          <Button variant="primary" icon={VERB_ICONS.export} disabled>
            {t`Export`}
          </Button>
        </KitState>
        <KitState label={t`Loading`}>
          <Button variant="primary" icon={VERB_ICONS.export} loading>
            {t`Exporting`}
          </Button>
        </KitState>
        <KitState label={t`Error`}>
          <Button status="error" icon={VERB_ICONS.retry}>
            {t`Try again`}
          </Button>
        </KitState>
        <KitState label={t`Success`}>
          <Button status="success" icon={VERB_ICONS.export}>
            {t`Exported`}
          </Button>
        </KitState>
      </KitStates>
    </KitSection>
  );
}

function SwitchDemo() {
  const { t } = useLingui();
  const [on, setOn] = useState(true);
  return (
    <Switch
      checked={on}
      onCheckedChange={setOn}
      label={t`Interface sounds`}
      description={t`Click the words: they are part of the switch.`}
    />
  );
}

function ChoiceDemo() {
  const { t } = useLingui();
  const [picked, setPicked] = useState<'wifi' | 'cable'>('wifi');
  const [music, setMusic] = useState(true);
  const [pace, setPace] = useState<'calm' | 'even' | 'quick'>('even');
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="flex flex-col gap-4">
        <Checkbox
          checked={music}
          onCheckedChange={setMusic}
          label={t`Music in the video`}
          description={t`The words tick the box too.`}
        />
        <RadioGroup
          aria-label={t`How the phone connects`}
          value={picked}
          onValueChange={(value) => setPicked(value === 'cable' ? 'cable' : 'wifi')}
        >
          <Radio value="wifi" label={t`Wi-Fi`} description={t`Scan a code; nothing to plug in.`} />
          <Radio value="cable" label={t`Cable`} description={t`Faster for long clips.`} />
        </RadioGroup>
      </div>
      <div className="flex flex-col gap-4">
        <SwitchDemo />
        <Segmented
          label={t`Pace`}
          value={pace}
          onChange={setPace}
          options={[
            { value: 'calm', label: t`Calm` },
            { value: 'even', label: t`Even` },
            { value: 'quick', label: t`Quick` },
          ]}
        />
      </div>
    </div>
  );
}

export function ChoicesGallery() {
  const { t } = useLingui();
  return (
    <KitSection
      title={t`Checkboxes, radios and switches`}
      icon={VERB_ICONS.select}
      description={t`A tick draws itself in; a dot grows from the middle; a thumb slides. Words are part of the hit area.`}
    >
      <ChoiceDemo />
      <KitPart title={t`Checkbox states`}>
        <KitStates min="8rem">
          <KitState label={t`Off`}>
            <Checkbox checked={false} onCheckedChange={noop} aria-label={t`Off`} />
          </KitState>
          <KitState label={t`On`}>
            <Checkbox checked onCheckedChange={noop} aria-label={t`On`} />
          </KitState>
          <KitState label={t`Mixed`}>
            <Checkbox checked="indeterminate" onCheckedChange={noop} aria-label={t`Mixed`} />
          </KitState>
          <KitState label={t`Focus`}>
            <Checkbox checked onCheckedChange={noop} aria-label={t`Focus`} className={SHOW_FOCUS} />
          </KitState>
          <KitState label={t`Disabled`}>
            <Checkbox checked onCheckedChange={noop} aria-label={t`Disabled`} disabled />
          </KitState>
          <KitState label={t`Loading`}>
            <Checkbox checked={false} onCheckedChange={noop} aria-label={t`Loading`} loading />
          </KitState>
          <KitState label={t`Error`}>
            <Checkbox checked={false} onCheckedChange={noop} aria-label={t`Error`} invalid />
          </KitState>
        </KitStates>
      </KitPart>
      <KitPart title={t`Switch states`}>
        <KitStates min="8rem">
          <KitState label={t`Off`}>
            <Switch checked={false} onCheckedChange={noop} aria-label={t`Off`} />
          </KitState>
          <KitState label={t`On`}>
            <Switch checked onCheckedChange={noop} aria-label={t`On`} />
          </KitState>
          <KitState label={t`Disabled`}>
            <Switch checked={false} onCheckedChange={noop} aria-label={t`Disabled`} disabled />
          </KitState>
          <KitState label={t`Loading`}>
            <Switch checked onCheckedChange={noop} aria-label={t`Loading`} loading />
          </KitState>
          <KitState label={t`Error`}>
            <Switch checked={false} onCheckedChange={noop} aria-label={t`Error`} invalid />
          </KitState>
        </KitStates>
      </KitPart>
    </KitSection>
  );
}

export function FieldsGallery() {
  const { t } = useLingui();
  return (
    <KitSection title={t`Fields`} icon={VERB_ICONS.edit}>
      <div className="grid max-w-md gap-1.5">
        <label htmlFor="kit-project-name" className="type-label text-ink">
          {t`Project name`}
        </label>
        <Input id="kit-project-name" placeholder={t`Goa trip, Sunday edit`} />
        <p className="m-0 type-meta text-ink-3">{t`Only you see this name.`}</p>
      </div>
      {/* Columns wide enough for the longest field value in every language (en-XA runs about 40 % longer). */}
      <KitStates min="16rem">
        <KitState label={t`Focus`}>
          <Input aria-label={t`Focused field`} className={SHOW_FOCUS} defaultValue={t`Sunday edit`} />
        </KitState>
        <KitState label={t`Disabled`}>
          <Input aria-label={t`Disabled field`} disabled defaultValue={t`Locked while exporting`} />
        </KitState>
        <KitState label={t`Error`}>
          <Input aria-label={t`Field with an error`} status="error" defaultValue={t`Sunday edit`} />
        </KitState>
        <KitState label={t`Success`}>
          <Input aria-label={t`Checked field`} status="success" defaultValue={t`Key checked`} />
        </KitState>
        <KitState label={t`Select`}>
          <Select aria-label={t`Pace`} defaultValue="even">
            <option value="calm">{t`Calm`}</option>
            <option value="even">{t`Even`}</option>
          </Select>
        </KitState>
        <KitState label={t`Select, loading`}>
          <Select aria-label={t`Model`} aria-busy>
            <option>{t`Checking…`}</option>
          </Select>
        </KitState>
        <KitState label={t`Select, error`}>
          <Select aria-label={t`Voice`} aria-invalid>
            <option>{t`Not available`}</option>
          </Select>
        </KitState>
        <KitState label={t`Select, disabled`}>
          <Select aria-label={t`Language`} disabled>
            <option>{t`English`}</option>
          </Select>
        </KitState>
      </KitStates>
    </KitSection>
  );
}
