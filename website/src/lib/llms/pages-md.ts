// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { ABOUT, JHAPTAAL } from '#content/about';
import { CONTACT_PAGE } from '#content/contact';
import { COST_SECTION, costLines } from '#content/cost';
import { PRESS } from '#content/press';
import { FAQ, FAQ_GROUPS } from '#content/faq';
import { FEATURE_GROUPS, FEATURE_STEPS, FEATURES, feature } from '#content/features';
import { BETA_TERMS, type GistRow, PRIVACY, PRIVACY_GIST, TERMS, type LegalDoc } from '#content/legal';
import { HOME_STORY, LLMS, MIRROR_LINES } from '#content/llms';
import { PLATFORM_GETS, PLATFORMS } from '#content/platforms';
import { API_KEYS, CHATGPT, LOCAL_ONLY, ON_DEVICE, OWN_SERVER, PROFILE_ON_UBUNTU, PROFILES, PROFILES_DEMO, PROVIDER_GRID, PROVIDERS } from '#content/providers';
import type { PageEntry } from '#content/schema';
import { SITE } from '#content/site';
import { WAITLIST_PAGE } from '#content/waitlist';
import { logoColours } from '#lib/og/palette';
import { absolute } from '#lib/seo';
import { bullets, doc, facts, heading, inline, link } from './markdown';
import { mirrorPath } from './mirror';

/**
 * Each listed page as Markdown, from the same content modules the pages render. A mirror opens with the page's title,
 * its description as a quote and its address, then the page's own words. Nothing here is typed twice.
 */

const waitlistLine = (): string => inline(LLMS.waitlist.replace('Join the waitlist', '[Join the waitlist](/waitlist/)'));

function legalBody(d: LegalDoc): string[] {
  return d.sections.flatMap((s) => [
    heading(2, s.heading),
    ...s.blocks.map((b) => (b.kind === 'p' ? inline(b.text) : b.kind === 'list' ? bullets(b.items) : facts(b.facts))),
  ]);
}

function home(): string {
  return doc(
    SITE.description,
    heading(2, HOME_STORY.problemsHeading),
    bullets(HOME_STORY.problems),
    heading(2, HOME_STORY.stepsHeading),
    bullets(HOME_STORY.steps),
    heading(2, 'Features'),
    ...FEATURE_GROUPS.flatMap((g) => [
      heading(3, g.title),
      bullets(FEATURES.filter((f) => f.group === g.id).map((f) => `${link(f.name, mirrorPath(`/features/${f.slug}/`))}: ${f.summary}`)),
    ]),
    heading(2, 'Your AI'),
    `${HOME_STORY.ai} ${link('Bring your own AI', mirrorPath('/ai/'))}.`,
    heading(2, COST_SECTION.heading),
    COST_SECTION.lead,
    bullets(costLines()),
    heading(2, 'Platforms'),
    bullets(PLATFORMS.map((p) => `${p.name}: ${p.line}`)),
    heading(2, 'Private by default'),
    HOME_STORY.private,
    waitlistLine(),
  );
}

/** /features/: its two groups, each with its lead, then each feature's definition and its page. */
function features(): string {
  return doc(
    ...FEATURE_GROUPS.flatMap((g) => [
      heading(2, g.title),
      g.lead,
      ...FEATURES.filter((f) => f.group === g.id).flatMap((f) => [
        heading(3, f.name),
        `${f.definition} ${link(`More about ${f.name.toLowerCase()}`, mirrorPath(`/features/${f.slug}/`))}.`,
      ]),
    ]),
    waitlistLine(),
  );
}

function featurePage(slug: string): string {
  const f = feature(slug);
  const steps = FEATURE_STEPS[slug] ?? [];
  return doc(
    f.definition,
    facts(f.facts),
    f.summary,
    ...(steps.length ? [heading(2, 'How it works'), ...steps.flatMap((s) => [heading(3, s.title), s.body])] : []),
    waitlistLine(),
  );
}

function ai(): string {
  const way = (w: keyof typeof PROVIDER_GRID.ways) => [
    heading(3, PROVIDER_GRID.ways[w].label),
    bullets(PROVIDERS.filter((p) => p.way === w).map((p) => `${p.name}: ${p.does}`)),
  ];
  return doc(
    MIRROR_LINES.ai,
    heading(2, CHATGPT.heading),
    CHATGPT.lead,
    bullets(CHATGPT.steps.map((s) => `${s.label}: ${s.line}`)),
    facts(CHATGPT.facts),
    heading(2, PROVIDER_GRID.heading),
    PROVIDER_GRID.lead,
    ...way('api-key'),
    API_KEYS.lead,
    API_KEYS.budget,
    ...way('own-server'),
    OWN_SERVER.lead,
    ...way('on-device'),
    heading(2, ON_DEVICE.heading),
    ON_DEVICE.lead,
    facts(ON_DEVICE.facts),
    heading(2, PROFILES_DEMO.heading),
    PROFILES_DEMO.lead,
    heading(3, 'Profiles'),
    MIRROR_LINES.profiles,
    facts(PROFILES),
    PROFILE_ON_UBUNTU,
    heading(3, LOCAL_ONLY.heading),
    LOCAL_ONLY.lead,
    `When it is on: ${LOCAL_ONLY.whenOn} ${LOCAL_ONLY.stillRuns}`,
    heading(3, 'What leaves your computer while it is off'),
    facts(LOCAL_ONLY.leavesWhenOff),
    heading(2, COST_SECTION.ai.heading),
    COST_SECTION.ai.lead,
    bullets(costLines()),
    waitlistLine(),
  );
}

function download(): string {
  return doc(
    MIRROR_LINES.download,
    ...PLATFORMS.flatMap((p) => [
      heading(2, p.name),
      p.line,
      PLATFORM_GETS[p.id],
      p.requirements.length > 0 ? facts(p.requirements) : undefined,
      `${link(`Join the waitlist for ${p.name}`, `/waitlist/?platform=${p.id}`)}.`,
    ]),
  );
}

function faq(): string {
  return doc(
    ...FAQ_GROUPS.flatMap((group) => [
      heading(2, group),
      ...FAQ.filter((e) => e.group === group).flatMap((e) => [heading(3, e.question), e.answer]),
    ]),
  );
}

function about(): string {
  return doc(
    ABOUT.definition,
    heading(2, ABOUT.name.heading),
    ABOUT.name.lead,
    facts(ABOUT.name.facts),
    heading(2, ABOUT.avartan.heading),
    ABOUT.avartan.lead,
    bullets(JHAPTAAL.map((g) => `Beats ${g.beats.join(', ')}, marked ${g.sign}: ${g.name}, ${g.gesture}, in ${g.colour}`)),
    ...ABOUT.avartan.body,
    heading(2, ABOUT.kaatu.heading),
    `${ABOUT.kaatu.nameBefore}${ABOUT.kaatu.hindi} (kaatna)${ABOUT.kaatu.nameAfter}`,
    ABOUT.kaatu.body,
    facts(ABOUT.kaatu.moods),
    heading(2, ABOUT.beliefs.heading),
    bullets(ABOUT.beliefs.items.map((b) => `**${b.belief}** ${b.why}`)),
    heading(2, ABOUT.company.heading),
    inline(ABOUT.company.body),
    heading(2, ABOUT.code.heading),
    ABOUT.code.body,
    heading(2, ABOUT.follow.heading),
    inline(ABOUT.follow.body),
  );
}

function press(): string {
  const values = logoColours();
  return doc(
    PRESS.oneLiner,
    heading(2, 'Describe Taalcut'),
    facts(PRESS.descriptions.map((d) => [d.label, d.text] as const)),
    heading(2, 'Facts'),
    facts(PRESS.facts),
    heading(2, 'The logo'),
    PRESS.logoLead,
    bullets(PRESS.logos.map((l) => `${link(l.label, l.href)} (SVG)`)),
    bullets(PRESS.logoRules),
    heading(2, 'Kaatu, the mascot'),
    PRESS.kaatuLead,
    bullets(PRESS.kaatu.map((k) => k.name)),
    bullets(PRESS.mascotRules),
    heading(2, 'The colours'),
    PRESS.coloursLead,
    facts(PRESS.colours.map((c, i) => [c.name, `${c.job}. On light grounds ${values[i]!.light}, on dark grounds ${values[i]!.dark}.`] as const)),
    heading(2, 'More files'),
    bullets(PRESS.files.map((f) => `${link(f.label, f.href)} (${f.format})`)),
    heading(2, PRESS.contactHeading),
    inline(PRESS.contact),
  );
}

function contact(): string {
  return doc(
    inline(MIRROR_LINES.contact.replace('the contact form', '[the contact form](/contact/)')),
    facts([
      ['Email', `[${SITE.email}](mailto:${SITE.email}): ${CONTACT_PAGE.mailbox.line}`],
      ['Instagram', `[${SITE.instagram.handle}](${SITE.instagram.url})`],
    ]),
  );
}

const gist = (g: { readonly heading: string; readonly rows: readonly GistRow[] }): string[] => [heading(2, g.heading), bullets(g.rows.map((r) => r.text))];
const legal =
  (d: LegalDoc, top?: { readonly heading: string; readonly rows: readonly GistRow[] }) =>
  (): string =>
    doc(d.status, d.definition, ...(top ? gist(top) : []), ...legalBody(d));

function betaTerms(): string {
  return doc(
    BETA_TERMS.definition,
    bullets(BETA_TERMS.lines),
    BETA_TERMS.ubuntuNote,
    BETA_TERMS.where,
    inline(BETA_TERMS.who),
    inline(BETA_TERMS.questions),
  );
}

const BODIES: Readonly<Record<string, () => string>> = {
  '/': home,
  '/features/': features,
  ...Object.fromEntries(FEATURES.map((f) => [`/features/${f.slug}/`, () => featurePage(f.slug)])),
  '/ai/': ai,
  '/download/': download,
  '/waitlist/': () =>
    doc(MIRROR_LINES.waitlist, `${link('Join the waitlist', '/waitlist/')}.`, heading(2, WAITLIST_PAGE.nextHeading), facts(WAITLIST_PAGE.facts)),
  '/faq/': faq,
  '/about/': about,
  '/press/': press,
  '/contact/': contact,
  '/privacy/': legal(PRIVACY, PRIVACY_GIST),
  '/terms/': legal(TERMS),
  '/beta-terms/': betaTerms,
};

/** Whether a page has a Markdown body (every listed page must; a test holds it). */
export function hasMarkdown(path: string): boolean {
  return path in BODIES;
}

/** A page's mirror: its title, its description, its address and its words. */
export function pageMarkdown(entry: PageEntry): string {
  const body = BODIES[entry.path];
  if (!body) throw new Error(`No Markdown for ${entry.path}`);
  return doc(heading(1, entry.title), `> ${entry.description}`, `Page: ${absolute(entry.path)}`, body().trimEnd());
}
