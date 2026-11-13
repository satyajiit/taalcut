// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · DESIGN.md: exact exported video beside destination and time controls.
 * States: loading, missing export/accounts, editable platform copy, saved posts; approval remains explicit. */
import { useLingui } from '@lingui/react/macro';
import {
  PRODUCT_COMMANDS,
  PRODUCT_PUBLISH_COMMANDS as C,
  type Product,
  type ProductCampaign,
  type TaalcutError,
  type productPublishDraftSchema,
} from '@taalcut/core';
import { Button, Checkbox, Input, Select, VERB_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import type { z } from 'zod';
import { useBackend } from '../../backend/backend';
import { useCommand } from '../../backend/use-command';
import { useBackendEvents } from '../../backend/use-events';
import { useRpcAction, useRpcQuery, useRpcStream } from '../../backend/use-rpc';
import { Field, LoadError } from '../settings/fields';
import { ProductEditsHandoff } from './product-edits-handoff';
import { DraftCopy, Publication, RenderPreview, PLATFORMS } from './product-publishing-copy';

type Draft = z.output<typeof productPublishDraftSchema>;

export function CampaignPublisher({
  campaign,
  product,
  onProductSaved,
}: {
  campaign: ProductCampaign;
  product: Product;
  onProductSaved: () => void;
}) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const command = useCommand();
  const accounts = useRpcQuery((signal) => backend.productPublishing.accounts({}, { signal }), [backend]);
  const renders = useRpcStream(
    (signal) => backend.renders.watch({ projectId: campaign.projectId }, { signal }),
    [backend, campaign.projectId],
  );
  const ledger = useRpcQuery(
    (signal) => backend.productPublishing.list({ campaignId: campaign.id }, { signal }),
    [backend, campaign.id],
  );
  const [accountIds, setAccountIds] = useState(
    product.channels.filter((item) => item.enabled).map((item) => item.accountId),
  );
  const [renderId, setRenderId] = useState('');
  const [scheduled, setScheduled] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState<TaalcutError | null>(null);
  const prepare = useRpcAction(backend.productPublishing.prepareMetadata);
  const ready =
    renders.data
      ?.filter((item) => item.status === 'ready' && item.deletedAt === null)
      .sort((a, b) => b.width * b.height - a.width * a.height || b.createdAt - a.createdAt) ?? [];
  const selected = ready.find((item) => item.id === renderId) ?? ready[0];
  const instagramDraft = drafts.find((draft) => draft.platform === 'instagram') ?? drafts[0];
  const busy = command.pending || prepare.pending;
  useBackendEvents(['command.changed'], ({ payload }) => {
    if (payload.name.startsWith('product.publish.')) ledger.reload();
    if (payload.name.startsWith('render.') || payload.name.startsWith('timeline.')) {
      renders.reload();
      setDrafts([]);
    }
  });
  useBackendEvents(['render.finished'], () => renders.reload());
  useBackendEvents(['library.changed'], () => {
    renders.reload();
    ledger.reload();
  });
  async function generate() {
    if (!selected || !scheduled) return;
    setError(null);
    const response = await prepare.run({
      campaignId: campaign.id,
      renderId: selected.id,
      accountIds,
      scheduledAt: new Date(scheduled).toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    if (response.ok) setDrafts(response.value);
    else setError(response.error);
  }
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <div className="grid min-w-0 gap-8 xl:grid-cols-[minmax(0,1.1fr)_minmax(240px,1fr)]">
        <section className="flex min-w-0 flex-col gap-5" aria-label={t`Video for publication`}>
          <h3 className="m-0 type-section text-ink">{t`The video you’re sharing`}</h3>
          {renders.status === 'error' ? (
            <LoadError error={renders.error} onRetry={renders.reload} what={t`Exports didn’t load.`} />
          ) : null}
          {selected ? (
            <>
              <Field
                htmlFor="publish-render"
                label={t`Exported video`}
                hint={t`Compatible renditions from this same timeline revision are selected per destination.`}
              >
                <Select
                  id="publish-render"
                  value={selected.id}
                  disabled={busy}
                  onChange={(event) => {
                    setRenderId(event.target.value);
                    setDrafts([]);
                  }}
                >
                  {ready.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {i18n.number(item.width)} × {i18n.number(item.height)} ·{' '}
                      {i18n.number(item.rate.num / item.rate.den)} {t`fps`}
                    </option>
                  ))}
                </Select>
              </Field>
              <RenderPreview render={selected} />
              {selected.width > selected.height &&
              accounts.data?.some(
                (account) =>
                  accountIds.includes(account.id) && ['youtube', 'instagram'].includes(account.platform),
              ) ? (
                <p className="m-0 type-body text-ink-2">{t`A compatible square or vertical delivery is needed for YouTube Shorts and Instagram. Your landscape master stays available for other destinations.`}</p>
              ) : null}
            </>
          ) : (
            <p className="m-0 rounded-lg bg-well p-5 type-body text-ink-2">{t`Export the approved video before preparing publication.`}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" asChild icon={VERB_ICONS.edit}>
              <Link
                to="/create/$projectId"
                params={{ projectId: campaign.projectId }}
              >{t`Improve this video`}</Link>
            </Button>
            {campaign.conversationId ? (
              <Button size="sm" variant="ghost" asChild>
                <Link
                  to="/chat/$conversationId"
                  params={{ conversationId: campaign.conversationId }}
                >{t`Continue with AI`}</Link>
              </Button>
            ) : null}
          </div>
        </section>
        <section
          className="flex min-w-0 flex-col gap-5 border-t border-rule pt-6 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-7"
          aria-label={t`Publishing destinations and time`}
        >
          <h3 className="m-0 type-section text-ink">{t`Where and when`}</h3>
          {accounts.status === 'error' ? (
            <LoadError
              error={accounts.error}
              onRetry={accounts.reload}
              what={t`Connect Postiz in Settings to load your accounts.`}
            />
          ) : null}
          {accounts.data?.length === 0 ? (
            <p className="m-0 type-body text-ink-2">{t`Connect a supported social account in Postiz, then refresh.`}</p>
          ) : null}
          <fieldset className="m-0 flex flex-wrap gap-4 border-0 p-0" disabled={busy}>
            <legend className="mb-3 type-label text-ink">{t`Destination accounts`}</legend>
            {accounts.data?.map((account) => (
              <Checkbox
                key={account.id}
                label={`${i18n._(PLATFORMS[account.platform])} · ${account.name}`}
                checked={accountIds.includes(account.id)}
                onCheckedChange={(checked) => {
                  setAccountIds(
                    checked ? [...accountIds, account.id] : accountIds.filter((id) => id !== account.id),
                  );
                  setDrafts([]);
                }}
              />
            ))}
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="ghost"
              icon={VERB_ICONS.checkAgain}
              onClick={accounts.reload}
            >{t`Refresh accounts`}</Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || !accounts.data}
              onClick={async () => {
                const channels = accounts
                  .data!.filter((item) => accountIds.includes(item.id))
                  .map((item) => ({ platform: item.platform, accountId: item.id, enabled: true }));
                const saved = await command.run({
                  name: PRODUCT_COMMANDS.update,
                  payload: {
                    productId: product.id,
                    revision: product.revision,
                    product: { ...product, channels },
                  },
                });
                if (saved.ok) onProductSaved();
              }}
            >{t`Use these accounts for this product`}</Button>
          </div>
          <Field
            htmlFor="publish-time"
            label={t`Publish time on this device`}
            hint={Intl.DateTimeFormat().resolvedOptions().timeZone}
          >
            <Input
              id="publish-time"
              type="datetime-local"
              value={scheduled}
              disabled={busy}
              onChange={(event) => {
                setScheduled(event.target.value);
                setDrafts([]);
              }}
            />
          </Field>
          <Button
            variant="primary"
            icon={VERB_ICONS.copy}
            className="self-start"
            loading={prepare.pending}
            disabled={
              busy || !selected || !accountIds.length || !scheduled || Date.parse(scheduled) <= Date.now()
            }
            onClick={() => void generate()}
          >{t`Prepare platform copy`}</Button>
          {error ? (
            <LoadError error={error} onRetry={() => void generate()} what={t`Publication needs attention.`} />
          ) : null}
          <ProductEditsHandoff
            product={product}
            campaign={campaign}
            render={selected}
            title={instagramDraft?.title}
            copyText={instagramDraft?.content}
            disabled={busy}
          />
        </section>
      </div>
      {drafts.length ? (
        <section className="flex flex-col gap-6 border-t border-rule pt-7" aria-label={t`Platform copy`}>
          <div>
            <h3 className="m-0 type-section text-ink">{t`Make each post your own`}</h3>
            <p className="mt-2 mb-0 type-body text-ink-2">{t`Review the copy for each account. Saving creates posts for a separate final approval.`}</p>
          </div>
          {drafts.map((draft, index) => (
            <DraftCopy
              key={draft.accountId}
              draft={draft}
              account={
                accounts.data?.find((account) => account.id === draft.accountId)?.name ?? draft.accountId
              }
              onChange={(next) => setDrafts(drafts.map((item, i) => (i === index ? next : item)))}
            />
          ))}
          {drafts.length ? (
            <Button
              className="self-start"
              variant="primary"
              icon={VERB_ICONS.next}
              iconPlacement="end"
              loading={command.pending}
              onClick={async () => {
                const saved = await command.run({ name: C.prepare, payload: { drafts } });
                if (saved.ok) {
                  setDrafts([]);
                  ledger.reload();
                }
              }}
            >{t`Save posts for final approval`}</Button>
          ) : null}
        </section>
      ) : null}
      <section className="flex flex-col gap-6 border-t border-rule pt-7" aria-label={t`Publishing history`}>
        <h3 className="m-0 type-section text-ink">{t`Saved posts and publishing history`}</h3>
        {ledger.data?.length === 0 ? (
          <p className="m-0 type-body text-ink-2">{t`Your saved posts will appear here for final review. Nothing is sent before you approve it.`}</p>
        ) : null}
        {ledger.status === 'error' ? (
          <LoadError error={ledger.error} onRetry={ledger.reload} what={t`Publishing history didn’t load.`} />
        ) : null}
        {ledger.data?.map((record) => (
          <Publication
            key={record.id}
            record={record}
            account={
              accounts.data?.find((account) => account.id === record.accountId)?.name ?? record.accountId
            }
            render={renders.data?.find((render) => render.id === record.renderId)}
            onChanged={ledger.reload}
          />
        ))}
      </section>
    </div>
  );
}
