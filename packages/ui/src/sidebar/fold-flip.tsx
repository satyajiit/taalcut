// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { Component, createRef, type ReactNode } from 'react';
import { foldTo, playFold, stopFold } from './fold-clock';

export interface FoldFlipProps {
  /** The sidebar's state; when it changes, the contents slide from where they were to their new place. */
  collapsed: boolean;
  /** Off: the contents jump (the bar's band coming or going with the shell, not a fold). */
  enabled: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Something that moves sideways when the sidebar folds (the window bar's
 * sidebar button and title): laid out in its new place at once, then slid
 * there from where it was on screen, on the fold's clock. Where it was is read
 * just before React changes the page (getSnapshotBeforeUpdate), so a fold that
 * turns round mid-way starts from where this one had got to.
 */
export class FoldFlip extends Component<FoldFlipProps> {
  private readonly box = createRef<HTMLDivElement>();

  override getSnapshotBeforeUpdate(previous: FoldFlipProps): number | null {
    const el = this.box.current;
    if (!el || !this.props.enabled || previous.collapsed === this.props.collapsed) return null;
    return el.getBoundingClientRect().left;
  }

  override componentDidUpdate(_previous: FoldFlipProps, _state: unknown, before: number | null): void {
    const el = this.box.current;
    if (before === null || !el) return;
    stopFold(el);
    const fold = foldTo(this.props.collapsed);
    const dx = before - el.getBoundingClientRect().left;
    if (Math.abs(dx) >= 0.5) playFold(el, [{ transform: `translateX(${dx}px)` }, { transform: 'none' }], fold);
  }

  override render() {
    return (
      <div ref={this.box} className={this.props.className}>
        {this.props.children}
      </div>
    );
  }
}
