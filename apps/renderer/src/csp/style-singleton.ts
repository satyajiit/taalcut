// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A CSP-safe stand-in for the `react-style-singleton` package (same exports),
 * wired in with a Vite alias (vite.config.ts).
 *
 * Radix dialogs and menus lock page scroll through react-remove-scroll, which
 * adds its rules as a <style> element. The app's CSP (style-src 'self') blocks
 * inline style elements, so the rules would not apply and every open dialog
 * would log a violation. A constructed stylesheet (adoptedStyleSheets) is not
 * an inline style, so CSP allows it.
 */
import { useEffect } from 'react';

export function stylesheetSingleton(): { add(css: string): void; remove(): void } {
  let counter = 0;
  let sheet: CSSStyleSheet | null = null;
  return {
    add(css) {
      if (counter === 0) {
        sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      }
      counter++;
    },
    remove() {
      counter--;
      if (counter === 0 && sheet) {
        const done = sheet;
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== done);
        sheet = null;
      }
    },
  };
}

export function styleHookSingleton(): (styles: string, isDynamic?: boolean) => void {
  const sheet = stylesheetSingleton();
  return (styles, isDynamic) => {
    // Same dependency rule as the original: re-run only for dynamic styles.
    useEffect(() => {
      sheet.add(styles);
      return () => sheet.remove();
    }, [styles && isDynamic]);
  };
}

export function styleSingleton(): (props: { styles: string; dynamic?: boolean }) => null {
  const useStyle = styleHookSingleton();
  return function Sheet({ styles, dynamic }) {
    useStyle(styles, dynamic);
    return null;
  };
}
