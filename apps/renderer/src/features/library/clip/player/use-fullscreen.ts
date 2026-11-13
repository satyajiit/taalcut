// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The player's column filling the screen (the viewer, its transport and the scrubber together, so the controls
 * stay at hand). Escape, or the button again, brings it back; the state follows the document's, so leaving by
 * the Mac's own controls is seen too.
 */
export function useFullscreen<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [active, setActive] = useState(false);
  /** The last request was refused (the window can't go full screen now): the button says so. */
  const [refused, setRefused] = useState(false);
  useEffect(() => {
    const follow = () =>
      setActive(document.fullscreenElement !== null && document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', follow);
    return () => document.removeEventListener('fullscreenchange', follow);
  }, []);
  const toggle = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const asked =
      document.fullscreenElement === element ? document.exitFullscreen() : element.requestFullscreen();
    asked.then(
      () => setRefused(false),
      () => setRefused(true),
    );
  }, []);
  return { ref, active, refused, toggle };
}
