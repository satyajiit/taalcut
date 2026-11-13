// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · DESIGN.md: research cadence before device operations; activity reads as a timeline.
 * States: enabled/disabled, registration approval/failure, saved schedule, unread/read updates and empty history. */

import { useLingui } from '@lingui/react/macro';
import { PRODUCT_COMMANDS, type ProductId, type ProductScheduleInput } from '@taalcut/core';
import { Button, Checkbox, CONCEPT_ICONS, EmptyState, Input, UserContent, VERB_ICONS } from '@taalcut/ui';
import { useState } from 'react';
import { useBackend } from '../../backend/backend';
import { useCommand } from '../../backend/use-command';
import { useBackendEvents } from '../../backend/use-events';
import { useRpcQuery } from '../../backend/use-rpc';
import { Field, Loading, LoadError } from '../settings/fields';
import { PRODUCT_ACTIVITY_WORDS } from './product-activity-words';
import { ProductHeading } from './product-layout';

export function ProductScheduleView({ productId }: { productId: ProductId }) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const command = useCommand();
  const schedule = useRpcQuery(
    (signal) => backend.products.schedule({ productId }, { signal }),
    [backend, productId],
  );
  const background = useRpcQuery((signal) => backend.productBackground.status({}, { signal }), [backend]);
  const Computer = CONCEPT_ICONS.thisComputer;
  return (
    <div className="flex flex-col gap-8">
      <ProductHeading
        title={t`Keep fresh ideas coming`}
      >{t`Choose when Taalcut researches this product. Publishing times are set separately when you approve a post.`}</ProductHeading>
      <section
        className="order-2 flex flex-col gap-4 border-t border-rule pt-7"
        aria-label={t`Background work`}
      >
        <h2 className="m-0 flex items-center gap-2 type-section text-ink">
          <Computer aria-hidden className="size-5 text-ink-2" />
          {t`Work continues on this device`}
        </h2>
        <p className="m-0 type-body text-ink-2">{t`Taalcut can research ideas and prepare drafts with its window closed. If the device sleeps, missed research resumes when it wakes. Postiz holds approved publishing times.`}</p>
        {background.status === 'error' ? (
          <LoadError
            error={background.error}
            onRetry={background.reload}
            what={t`Background status didn’t load.`}
          />
        ) : null}
        {background.data ? (
          <>
            <Checkbox
              label={t`Enable local background work`}
              checked={background.data.enabled}
              disabled={command.pending || (!background.data.supported && !background.data.enabled)}
              onCheckedChange={async (enabled) => {
                await command.run({ name: PRODUCT_COMMANDS.setBackground, payload: { enabled } });
                background.reload();
              }}
            />
            {!background.data.supported ? (
              <p className="m-0 type-meta text-ink-2">{t`Background work is available in the installed desktop app on supported systems.`}</p>
            ) : null}
            {background.data.registration === 'approval-required' ? (
              <p className="m-0 type-body text-ink-2">{t`Allow Taalcut’s background item in your system settings to finish enabling scheduled work.`}</p>
            ) : null}
            {background.data.registration === 'failed' ? (
              <p className="m-0 type-body text-danger-strong">{t`Background registration needs attention. Try enabling it again.`}</p>
            ) : null}
          </>
        ) : null}
      </section>
      {schedule.status === 'loading' && !schedule.data ? <Loading /> : null}
      {schedule.status === 'error' ? (
        <LoadError error={schedule.error} onRetry={schedule.reload} what={t`This schedule didn’t load.`} />
      ) : null}
      {schedule.data ? (
        <ScheduleForm
          key={`${productId}:${schedule.data.schedule?.revision ?? 0}`}
          initial={
            schedule.data.schedule ?? {
              productId,
              revision: 1,
              enabled: false,
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              localTime: '09:00',
              weekdays: [1, 2, 3, 4, 5],
            }
          }
          onSaved={schedule.reload}
        />
      ) : null}
      {schedule.data?.schedule?.nextRunAt ? (
        <p className="m-0 type-body text-ink-2">
          {t`Next research:`}{' '}
          <time dateTime={new Date(schedule.data.schedule.nextRunAt).toISOString()}>
            {i18n.date(schedule.data.schedule.nextRunAt, {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone: schedule.data.schedule.timeZone,
            })}
          </time>
        </p>
      ) : null}
    </div>
  );
}

function ScheduleForm({ initial, onSaved }: { initial: ProductScheduleInput; onSaved: () => void }) {
  const { t, i18n } = useLingui();
  const command = useCommand();
  const [value, setValue] = useState(initial);
  const days = [1, 2, 3, 4, 5, 6, 0];
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={async (event) => {
        event.preventDefault();
        const result = await command.run({ name: PRODUCT_COMMANDS.schedule, payload: { schedule: value } });
        if (result.ok) onSaved();
      }}
    >
      <Checkbox
        label={t`Research this product on a schedule`}
        checked={value.enabled}
        onCheckedChange={(enabled) => setValue({ ...value, enabled })}
        disabled={command.pending}
      />
      <div className="grid gap-6 sm:grid-cols-2">
        <Field htmlFor="product-schedule-time" label={t`Local time`}>
          <Input
            id="product-schedule-time"
            type="time"
            value={value.localTime}
            required
            disabled={command.pending}
            onChange={(event) => setValue({ ...value, localTime: event.target.value })}
          />
        </Field>
        <Field htmlFor="product-timezone" label={t`Time zone`}>
          <Input
            id="product-timezone"
            value={value.timeZone}
            required
            maxLength={100}
            disabled={command.pending}
            onChange={(event) => setValue({ ...value, timeZone: event.target.value })}
          />
        </Field>
      </div>
      <fieldset className="m-0 flex flex-wrap gap-4 border-0 p-0">
        <legend className="mb-3 type-label text-ink">{t`Research days`}</legend>
        {days.map((day) => (
          <Checkbox
            key={day}
            label={i18n.date(new Date(Date.UTC(2026, 10, 1 + day)), { weekday: 'short', timeZone: 'UTC' })}
            checked={value.weekdays.includes(day)}
            disabled={command.pending}
            onCheckedChange={(checked) => {
              const weekdays = checked
                ? [...value.weekdays, day]
                : value.weekdays.filter((item) => item !== day);
              if (weekdays.length) setValue({ ...value, weekdays });
            }}
          />
        ))}
      </fieldset>
      <Button
        type="submit"
        variant="primary"
        icon={VERB_ICONS.approve}
        className="self-start"
        loading={command.pending}
      >{t`Save schedule`}</Button>
    </form>
  );
}

export function ProductActivity({ productId }: { productId: ProductId }) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const command = useCommand();
  const Event = CONCEPT_ICONS.version;
  const activity = useRpcQuery(
    (signal) => backend.products.activity({ productId }, { signal }),
    [backend, productId],
  );
  useBackendEvents(['library.changed'], () => activity.reload());
  useBackendEvents(['command.changed'], ({ payload }) => {
    if (payload.name.startsWith('product.')) activity.reload();
  });
  return (
    <section className="flex flex-col gap-6" aria-label={t`Activity`}>
      <ProductHeading
        title={t`What’s been happening`}
      >{t`Research, drafts and publishing updates in one place.`}</ProductHeading>
      {activity.status === 'loading' && !activity.data ? <Loading /> : null}
      {activity.status === 'error' ? (
        <LoadError error={activity.error} onRetry={activity.reload} what={t`Activity didn’t load.`} />
      ) : null}
      {activity.data?.items.length === 0 ? (
        <EmptyState
          className="py-6"
          title={t`The story will unfold here.`}
          description={t`Research and publishing updates will appear here, even if system notifications are off.`}
        />
      ) : null}
      {activity.data?.items.map((item) => (
        <article
          key={item.id}
          className="relative ml-2 flex items-start gap-4 border-l border-rule pb-6 pl-7"
        >
          <Event aria-hidden className="absolute -left-2 top-0 size-4 bg-canvas text-ink-2" />
          <div className="min-w-0 flex-1">
            <p className="m-0 type-label text-ink">{i18n._(PRODUCT_ACTIVITY_WORDS[item.kind])}</p>
            <UserContent className="block type-meta text-ink-2">{item.title}</UserContent>
            <UserContent className="mt-1 block type-body text-ink-2">{item.body}</UserContent>
            <time
              className="mt-2 block type-meta text-ink-3"
              dateTime={new Date(item.createdAt).toISOString()}
            >
              {i18n.date(item.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}
            </time>
          </div>
          {!item.readAt ? (
            <Button
              size="sm"
              variant="ghost"
              icon={VERB_ICONS.approve}
              disabled={command.pending}
              onClick={async () => {
                await command.run({ name: PRODUCT_COMMANDS.readNotification, payload: { id: item.id } });
                activity.reload();
              }}
            >{t`Mark read`}</Button>
          ) : null}
        </article>
      ))}
    </section>
  );
}
