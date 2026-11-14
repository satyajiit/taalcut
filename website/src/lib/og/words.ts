// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A page's words as its social card can draw them. The card is drawn in Onest's static cuts alone (card.ts), with no
 * second face to fall back on, and Onest has no rupee sign: left as it is, "₹37,600" comes out as an empty box. So
 * on the card, and only there, rupees are written with their code: "INR 37,600". Pages keep the sign: a browser
 * borrows it from another face.
 */
export function cardWords(text: string): string {
  return text.replaceAll('₹', 'INR ');
}
