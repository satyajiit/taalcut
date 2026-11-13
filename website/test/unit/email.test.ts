// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { EMAIL_MAX, emailProblem, normalizeEmail } from '#lib/email';

describe('email', () => {
  it('normalises to one entry per person', () => {
    expect(normalizeEmail('  Asha@Example.COM ')).toBe('asha@example.com');
  });

  it('accepts real addresses', () => {
    for (const ok of ['a@b.co', 'first.last+reels@studio.example.in', 'ñandú@correo.es']) expect(emailProblem(ok), ok).toBeNull();
  });

  it('names the problem', () => {
    expect(emailProblem('   ')).toBe('empty');
    expect(emailProblem('asha@example')).toBe('malformed');
    expect(emailProblem('asha example.com')).toBe('malformed');
    expect(emailProblem('a/b@example.com')).toBe('malformed');
    expect(emailProblem(`${'a'.repeat(EMAIL_MAX)}@x.co`)).toBe('too-long');
  });
});
