// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One URL for every route the app has, so the end-to-end checks visit them all.
 * test/routes.test.ts fails if a route is added without an entry here.
 */
export interface RouteSample {
  /** Short name, used for screenshot file names. */
  name: string;
  path: string;
  /** Where the app should end up, when the route redirects. */
  lands?: string;
  /**
   * The route loads data: the skeletons (by <Skeleton name>) it must show
   * within 100 ms of navigating to it (PRD R32). Checked by skeleton.spec.ts.
   */
  skeletons?: readonly string[];
}

// A well-formed ULID: the stubs accept any valid id.
const ID = '01K7C5M6Q8R9S0T1V2W3X4Y5Z6';
/** The fake library's clip 1264 and the fake's first template (backend/fake/library/seed.ts fakeUlid). */
export const CLIP = '01K7C5M6Q8100000000000017G';
export const TEMPLATE = '01K7C5M6Q85000000000000001';
/** The fake chat's hidden review demo (chat/fake-seed.ts REVIEW_CONVERSATION_ID, REVIEW_APPROVAL_ID). */
export const REVIEW_CHAT = '01K7C5M6Q8R9S0T1V2W3X400W6';
export const REVIEW_APPROVAL = 'ap-review-demo';
/** The fake chat's hidden chat with grouped tool calls (chat/fake-seed.ts TOOLS_CONVERSATION_ID). */
export const TOOLS_CHAT = '01K7C5M6Q8R9S0T1V2W3X400W7';
/** The Make fakes' Golden hour market (backend/fake/make/ids.ts GOLDEN_PROJECT): three videos of 12 clips. */
export const PROJECT = '01K7C5M6Q8R9S0T1V2W3X4Y5ZA';
/** Hidden Create/Product workspaces (backend/fake/{creation,products}/*-fixtures.ts). */
export const CREATION = '01K7C5M6Q8X000000000000001';
export const PRODUCT = '01K7C5M6Q8Y000000000000001';

export const ROUTES: readonly RouteSample[] = [
  { name: 'root', path: '/', lands: '/chat' },
  { name: 'onboarding', path: '/onboarding' },
  // Shown in alpha and internal builds; the route is there in every build.
  { name: 'onboarding-alpha', path: '/onboarding/alpha' },
  { name: 'onboarding-sources', path: '/onboarding/sources' },
  { name: 'onboarding-first-video', path: '/onboarding/first-video' },
  // Your chats are in the sidebar on every page (shell/recent-chats.tsx): loaded at launch, so the
  // chat pages have nothing of their own to wait for but the transcript.
  { name: 'chat', path: '/chat' },
  // The fake chat client seeds this id with a conversation that shows every card type.
  { name: 'chat-conversation', path: `/chat/${ID}`, skeletons: ['chat-transcript'] },
  // UX4: the review page of the fake's hidden demo chat (chat/fake-seed.ts reviewDemo), its export waiting.
  { name: 'chat-review', path: `/chat/${REVIEW_CHAT}/review/${REVIEW_APPROVAL}` },
  // FIX-TOOLGROUPS: a run that inspected eleven clips at once (one failed) and looked at three frames, from history.
  { name: 'chat-tools', path: `/chat/${TOOLS_CHAT}` },
  { name: 'create', path: '/create' },
  { name: 'create-new', path: '/create/new' },
  { name: 'create-project', path: `/create/${CREATION}` },
  { name: 'products', path: '/products' },
  { name: 'products-new', path: '/products/new' },
  { name: 'products-product', path: `/products/${PRODUCT}` },
  { name: 'insights', path: '/insights' },
  { name: 'library', path: '/library' },
  { name: 'library-sources', path: '/library/sources' },
  { name: 'library-source', path: `/library/sources/${ID}` },
  { name: 'library-imports', path: '/library/imports' },
  { name: 'library-import-session', path: `/library/imports/${ID}` },
  { name: 'library-import', path: '/library/import' },
  { name: 'library-import-connect', path: '/library/import/files' },
  { name: 'library-import-help', path: '/library/import/files/help' },
  { name: 'library-import-choose', path: `/library/import/folder/${ID}/choose` },
  { name: 'library-import-review', path: `/library/import/files/${ID}/review` },
  // From your phone: /library/phone lands on a tab (Wi-Fi with nothing connected); the Mac listens once Wi-Fi shows.
  { name: 'library-phone', path: '/library/phone', lands: '/library/import/phone-wifi' },
  { name: 'library-phone-wifi', path: '/library/phone/wifi', lands: '/library/import/phone-wifi' },
  { name: 'library-phone-cable', path: '/library/phone/cable', lands: '/library/import/phone-cable' },
  {
    name: 'library-phone-transfers',
    path: '/library/phone/transfers',
    lands: '/library/imports\\?phones=true',
  },
  { name: 'library-phone-help', path: '/library/phone/help', lands: '/library/import/phone-wifi/help' },
  // A clip the fake library has (IMG_5264.MOV: seven shots, Spanish speech), and one it doesn't.
  { name: 'library-asset', path: `/library/${CLIP}`, skeletons: ['clip-page'] },
  { name: 'library-asset-missing', path: `/library/${ID}` },
  { name: 'templates', path: '/templates', skeletons: ['templates-list'] },
  // UX4 tpl: Templates by task. A folder is a page (Favourites, Not in a folder, or a folder's id); the old
  // `?folder=` lands there.
  { name: 'templates-folder', path: '/templates/folders/favourites', skeletons: ['templates-list'] },
  { name: 'templates-folder-search', path: '/templates?folder=unfiled', lands: '/templates/folders/unfiled' },
  { name: 'templates-new', path: '/templates/new' },
  // Start from…: starters, formats and the community (the template hub, P3-B12: the fake's 40 templates, and
  // Morning café).
  { name: 'templates-start', path: '/templates/start' },
  { name: 'templates-start-formats', path: '/templates/start/formats' },
  { name: 'templates-start-community', path: '/templates/start/community' },
  {
    name: 'templates-start-community-template',
    path: '/templates/start/community/01K7C5M6Q8H000000000000001',
  },
  // The hub's old addresses land in Start from… › Community.
  { name: 'templates-hub', path: '/templates/hub', lands: '/templates/start/community' },
  {
    name: 'templates-hub-template',
    path: '/templates/hub/01K7C5M6Q8H000000000000001',
    lands: '/templates/start/community/01K7C5M6Q8H000000000000001',
  },
  // The fake's Golden hour market: 12 slots at 120 BPM, version 2. Its overview, then its three other pages.
  { name: 'templates-template', path: `/templates/${TEMPLATE}`, skeletons: ['template-detail'] },
  { name: 'templates-template-slots', path: `/templates/${TEMPLATE}/slots`, skeletons: ['template-slots'] },
  {
    name: 'templates-template-pacing',
    path: `/templates/${TEMPLATE}/pacing`,
    skeletons: ['template-pacing'],
  },
  {
    name: 'templates-template-details',
    path: `/templates/${TEMPLATE}/details`,
    skeletons: ['template-details'],
  },
  // Saved on Instagram: All Saved (signed out in the fake), a collection, and its settings.
  { name: 'templates-saved', path: '/templates/saved' },
  { name: 'templates-saved-collection', path: '/templates/saved/col_inspo' },
  { name: 'templates-saved-settings', path: '/templates/saved/settings' },
  // The Make fakes' projects (backend/fake/make/seed.ts), and the archived one.
  { name: 'projects', path: '/projects', skeletons: ['make-projects'] },
  { name: 'projects-archived', path: '/projects?archived=true', skeletons: ['make-projects'] },
  // The editor on Golden hour market's first video.
  { name: 'project-timeline', path: `/projects/${PROJECT}/timeline` },
  { name: 'renders', path: '/renders', skeletons: ['make-exports'] },
  // Your style: its bones are drawn by hand (StyleProfileBones), not captured, as on a template's page.
  { name: 'projects-style', path: '/projects/style' },
  // UX4 set: Settings opens on General; General's row stands for Updates, This Mac and About (their own pages).
  { name: 'settings', path: '/settings', lands: '/settings/general' },
  // Settings' pages each have a named skeleton (UX1 W2-2); Memory has nothing to load.
  { name: 'settings-general', path: '/settings/general', skeletons: ['settings-language'] },
  { name: 'settings-updates', path: '/settings/updates', skeletons: ['settings-updates'] },
  { name: 'settings-this-mac', path: '/settings/this-mac', skeletons: ['settings-this-mac'] },
  { name: 'settings-about', path: '/settings/about', skeletons: ['settings-about'] },
  { name: 'settings-models', path: '/settings/models', skeletons: ['settings-models'] },
  { name: 'settings-models-downloads', path: '/settings/models/downloads' },

  { name: 'settings-accounts', path: '/settings/accounts', skeletons: ['settings-accounts'] },
  { name: 'settings-accounts-keys', path: '/settings/accounts/keys', skeletons: ['settings-accounts-keys'] },
  {
    name: 'settings-accounts-subscriptions',
    path: '/settings/accounts/subscriptions',
    skeletons: ['settings-accounts-subscriptions'],
  },
  {
    name: 'settings-accounts-servers',
    path: '/settings/accounts/servers',
    skeletons: ['settings-accounts-servers'],
  },
  { name: 'settings-plugins', path: '/settings/plugins', skeletons: ['settings-plugins'] },
  // A plugin opens on its connection; each view is its own page.
  {
    name: 'settings-plugin-postiz',
    path: '/settings/plugins/postiz',
    lands: '/settings/plugins/postiz/connection',
    skeletons: ['settings-plugin-detail'],
  },
  { name: 'settings-plugin-postiz-connection', path: '/settings/plugins/postiz/connection' },
  { name: 'settings-plugin-postiz-access', path: '/settings/plugins/postiz/access' },
  { name: 'settings-plugin-postiz-tools', path: '/settings/plugins/postiz/tools' },
  { name: 'settings-plugin-postiz-skills', path: '/settings/plugins/postiz/skills' },
  {
    name: 'settings-external-agents',
    path: '/settings/external-agents',
    skeletons: ['settings-external-agents'],
  },
  { name: 'settings-sources', path: '/settings/sources', skeletons: ['settings-sources'] },
  // Brand kits (P3-V10): the fake's two kits, and Chai & Co.'s editor, which opens on its colours.
  { name: 'settings-brand', path: '/settings/brand', skeletons: ['settings-brand'] },
  {
    name: 'settings-brand-kit',
    path: '/settings/brand/01K7C5M6Q8Z000000000000001',
    lands: '/settings/brand/01K7C5M6Q8Z000000000000001/colours',
    skeletons: ['settings-brand-kit'],
  },
  { name: 'settings-brand-kit-colours', path: '/settings/brand/01K7C5M6Q8Z000000000000001/colours' },
  { name: 'settings-brand-kit-type', path: '/settings/brand/01K7C5M6Q8Z000000000000001/type' },
  { name: 'settings-brand-kit-captions', path: '/settings/brand/01K7C5M6Q8Z000000000000001/captions' },
  { name: 'settings-brand-kit-logo', path: '/settings/brand/01K7C5M6Q8Z000000000000001/logo' },
  { name: 'settings-brand-kit-intro-outro', path: '/settings/brand/01K7C5M6Q8Z000000000000001/intro-outro' },
  { name: 'settings-privacy', path: '/settings/privacy', skeletons: ['settings-privacy'] },
  {
    name: 'settings-privacy-sharing',
    path: '/settings/privacy/sharing',
    skeletons: ['settings-privacy-sharing'],
  },
  // LRN1-MEM: the remembered items, and where memory goes.
  {
    name: 'settings-memory',
    path: '/settings/memory',
    skeletons: ['settings-memory', 'settings-memory-cloud'],
  },
  // The totals' and the breakdown's bones wait 300 ms on purpose (a quick answer doesn't flash them); the budgets
  // and the request log show theirs at once.
  { name: 'settings-usage', path: '/settings/usage' },
  { name: 'settings-usage-breakdown', path: '/settings/usage/breakdown' },
  {
    name: 'settings-usage-budgets',
    path: '/settings/usage/budgets',
    // Your projects' bones show once the budgets have loaded (the section is drawn under them), so not marked here.
    skeletons: ['settings-usage-budgets'],
  },
  {
    name: 'settings-usage-requests',
    path: '/settings/usage/requests',
    skeletons: ['settings-usage-requests'],
  },
  { name: 'dev-traces', path: '/dev/traces' },
  { name: 'dev-kit', path: '/dev/kit' },
  // UX4 lane type: the candidate typefaces through every type role (Part A, for the owner's pick).
  { name: 'dev-type', path: '/dev/type' },
  { name: 'not-found', path: '/no-such-page' },
  { name: 'not-found-bad-id', path: '/library/not-an-id' },
];
