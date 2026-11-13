// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A brand kit's five views (UX4), each a child route of the editor's layout (brand-kit-editor.tsx), which makes the
 * editor once per kit and hands it down, with the preview beside every view.
 */
import { useLingui } from '@lingui/react/macro';
import { SETTINGS_ICONS } from '../settings/settings-icons';
import { Part, useBrandEditor } from './brand-kit-editor';
import { BumperField } from './bumper-field';
import { CaptionFields } from './caption-fields';
import { ColourFields } from './colour-fields';
import { CreatorFields } from './creator-fields';
import { FontFields } from './font-fields';
import { LogoField } from './logo-field';
import { WatermarkField } from './watermark-field';

/** Colours: the kit's five colours. */
export function BrandColoursView() {
  const { t } = useLingui();
  const editor = useBrandEditor();
  return (
    <Part icon={SETTINGS_ICONS.colours} title={t`Colours`} fields={['colours']}>
      <ColourFields editor={editor} />
    </Part>
  );
}

/** Type: the fonts for titles and on-screen text. */
export function BrandTypeView() {
  const { t } = useLingui();
  const editor = useBrandEditor();
  return (
    <Part
      icon={SETTINGS_ICONS.type}
      title={t`Fonts`}
      description={t`For titles and on-screen text.`}
      fields={['fonts']}
    >
      <FontFields editor={editor} />
    </Part>
  );
}

/** Captions: how spoken words look on every video with this kit. */
export function BrandCaptionsView() {
  const { t } = useLingui();
  const editor = useBrandEditor();
  return (
    <Part icon={SETTINGS_ICONS.captions} title={t`Captions`} fields={['captions']}>
      <CaptionFields editor={editor} />
    </Part>
  );
}

/** Logo: the logo, and the watermark, which can be the logo. */
export function BrandLogoView() {
  const { t } = useLingui();
  const editor = useBrandEditor();
  return (
    <>
      <Part
        icon={SETTINGS_ICONS.logo}
        title={t`Creator identity`}
        description={t`Used for your shorts, ending text and publishing copy.`}
        fields={['creator']}
      >
        <CreatorFields editor={editor} />
      </Part>
      <Part icon={SETTINGS_ICONS.logo} title={t`Logo`} fields={['logo']}>
        <LogoField editor={editor} />
      </Part>
      <Part
        icon={SETTINGS_ICONS.logo}
        title={t`Watermark`}
        description={t`Faint, in a corner of every frame.`}
        fields={['watermark']}
      >
        <WatermarkField editor={editor} />
      </Part>
    </>
  );
}

/** Intro and outro: what plays before and after every video with this kit. */
export function BrandBumpersView() {
  const { t } = useLingui();
  const editor = useBrandEditor();
  return (
    <Part
      icon={SETTINGS_ICONS.bumpers}
      title={t`Intro and outro`}
      description={t`What plays before and after every video with this kit.`}
      fields={['intro', 'outro']}
    >
      <div className="flex flex-col gap-6">
        <BumperField editor={editor} which="intro" />
        <BumperField editor={editor} which="outro" />
      </div>
    </Part>
  );
}
