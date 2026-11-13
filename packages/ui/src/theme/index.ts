// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

export type { ThemeBridge } from './bridge';
export { isThemePreference, THEME_OPTIONS, THEME_STORAGE_KEY } from './preferences';
export {
  ThemeProvider,
  ThemeSwitcher,
  useTheme,
  type ThemeSwitcherProps,
  type UseTheme,
} from './react';
export {
  createThemeEngine,
  defaultThemeStore,
  electronStore,
  localStorageStore,
  type SetPreferenceOptions,
  type ThemeEngine,
  type ThemeStore,
} from './theme-engine';
export { ThemeIcon, type ThemeIconProps } from './theme-icon';
export { ThemeScenePreview } from './theme-scene.preview';
export { ThemeToggle, useThemeToggleLabel, type ThemeToggleProps } from './theme-toggle';
export { horizonReaches, onThemeScene, preloadScene, SCENE_MS, type SceneKind } from './theme-scene';
export {
  centreOf,
  originOf,
  runThemeTransition,
  scenePlays,
  THEME_TRANSITION_ATTRIBUTE,
  THEME_TRANSITION_MS,
  type Point,
  type ThemeTransitionOptions,
} from './theme-transition';
