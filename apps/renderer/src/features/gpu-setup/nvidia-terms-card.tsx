// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: NVIDIA's terms card · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.2 "Decision cards" (as the warning card: `raised`, a `rule` hairline all round, `xl` radius,
 *   no shadow, the title at 700) · LNX1-TRM: before anything of NVIDIA's downloads, whose libraries they are, that
 *   NVIDIA licenses them to the person, that Taalcut only downloads and installs them, and NVIDIA's own terms
 *   linked, each opening in the browser. "Accept and install" is the screen's one marigold fill; "Not now" a quiet
 *   secondary. The footnote says what happens without them. Size and GPU come from the download and the probe.
 * states: shown (the card) · accepting ("Accept and install" loading until the download re-plans; the card then
 *   goes) · failed to record (ErrorLine under the buttons, Accept again) · declined (gone for this session in first
 *   run; Settings keeps its row) · the buttons carry Button's eight states, the links BrowserLink's
 * pre-emit critique: P5 H4 E5 S5 R5 V4 · slop subset: pass (1-7, 10-19, 22-27, 37-38a, 40-41, 46-49)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { Button, cn, ErrorLine } from '@taalcut/ui';
import { Gpu } from 'lucide-react';
import { useId } from 'react';
import { BrowserLink } from '../../chat/external-link';
import { formatBytes } from '../shared/format';
import { ownerBrand, type AcceptTerms, type TermsComponent } from './nvidia-terms';

export interface NvidiaTermsCardProps {
  /** The CUDA runtime as the download holds it back (`awaitingTerms`), its terms not accepted. */
  readonly component: TermsComponent;
  /** The probe's name for the GPU it would run on; the card says "your NVIDIA GPU" without one. */
  readonly gpuName?: string | undefined;
  readonly accept: AcceptTerms;
  /** "Not now": none where the card is the row's own (Settings closes it with its row). */
  readonly onDecline: () => void;
  readonly className?: string;
}

/** Whose terms, linked: each document by its own title, in the browser. */
export function TermsDocuments({ component }: { component: TermsComponent }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {component.terms.documents.map((document) => (
        <li key={document.url} translate="no">
          <BrowserLink href={document.url}>{document.title}</BrowserLink>
        </li>
      ))}
    </ul>
  );
}

export function NvidiaTermsCard({ component, gpuName, accept, onDecline, className }: NvidiaTermsCardProps) {
  const { i18n } = useLingui();
  const titleId = useId();
  const size = formatBytes(i18n, component.sizeBytes);
  const owner = component.terms.owner;
  const brand = ownerBrand(owner);
  const busy = accept.accepting === component.id;
  return (
    <section
      aria-labelledby={titleId}
      data-slot="nvidia-terms"
      data-component={component.id}
      className={cn('flex flex-col gap-4 rounded-xl border border-rule bg-raised p-5 text-ink', className)}
    >
      <header className="flex items-start gap-3">
        <Gpu aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-2" />
        <h3 id={titleId} className="m-0 text-lg font-bold">
          <Trans>Use your NVIDIA GPU for local models</Trans>
        </h3>
      </header>
      <div className="flex flex-col gap-3 ps-8 text-base">
        <p className="m-0">
          {gpuName ? (
            <Trans>
              Taalcut can download NVIDIA’s CUDA libraries ({size}) so its models run on your{' '}
              <span translate="no">{gpuName}</span>.
            </Trans>
          ) : (
            <Trans>
              Taalcut can download NVIDIA’s CUDA libraries ({size}) so its models run on your NVIDIA GPU.
            </Trans>
          )}{' '}
          <Trans>
            These libraries are made and owned by <span translate="no">{owner}</span>, and{' '}
            <span translate="no">{brand}</span> licenses them to you under its own terms. Taalcut doesn’t own,
            change or sell them. It only downloads and installs them on this computer so it can use your GPU.
          </Trans>
        </p>
        <div className="flex flex-col gap-1.5">
          <p className="m-0 text-sm font-semibold text-ink-2">
            <Trans>
              To install them, you accept <span translate="no">{brand}</span>’s terms:
            </Trans>
          </p>
          <TermsDocuments component={component} />
        </div>
      </div>
      <div className="flex flex-col gap-2 ps-8">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            data-action="accept-terms"
            loading={busy}
            onClick={() => accept.accept(component)}
          >
            <Trans>Accept and install</Trans>
          </Button>
          <Button data-action="decline-terms" disabled={busy} onClick={onDecline}>
            <Trans>Not now</Trans>
          </Button>
        </div>
        {accept.error && !busy ? (
          <ErrorLine key={accept.error.code} error={accept.error} onRetry={() => accept.accept(component)} />
        ) : null}
        <p className="m-0 text-sm text-ink-2">
          <Trans>
            Without them, models use your GPU through WebGPU or Vulkan where they can, and the CPU otherwise.
            Everything still works, more slowly. You can install them later in Settings › Models.
          </Trans>
        </p>
      </div>
    </section>
  );
}
