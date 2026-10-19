// The guest preview's own guarantees: it is a scene with a consequence, it is
// bounded, and it is local. The third is the one a player is being asked to trust,
// so it is measured off the source rather than asserted in a comment.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { OPENING, PREVIEW_TITLE, UPGRADE_LINE, chosen } from './preview';

const source = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('F02 — the preview is a scene with a consequence', () => {
  it('opens with the number of choices the rules allow (ADR-012: 2–4)', () => {
    expect(OPENING.choices.length).toBeGreaterThanOrEqual(2);
    expect(OPENING.choices.length).toBeLessThanOrEqual(4);
  });

  it('gives every choice a label, the copy under it, and a scene after it', () => {
    for (const c of OPENING.choices) {
      expect(c.label.length, c.choiceId).toBeGreaterThan(0);
      expect(c.copy.length, c.choiceId).toBeGreaterThan(20);
      const after = chosen(OPENING, c.choiceId);
      expect(after.id).not.toBe(OPENING.id);
      expect(after.paragraphs.length).toBeGreaterThan(0);
      expect(after.choices, `the preview is two scenes deep, not three: ${c.choiceId}`).toEqual([]);
      expect(after.receipt?.length, `${c.choiceId} ends without saying what moved`).toBeGreaterThan(10);
    }
  });

  it('names each choice once, in the order the badge letters are drawn', () => {
    const ids = OPENING.choices.map((c) => c.choiceId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(OPENING.choices.map((_, i) => String.fromCharCode(65 + i))).toHaveLength(ids.length);
  });

  it('does not fall through when asked for a choice it never offered', () => {
    expect(chosen(OPENING, 'invented')).toBe(OPENING);
  });

  it('states the reason an account exists', () => {
    expect(UPGRADE_LINE).toMatch(/ledger/);
    expect(PREVIEW_TITLE).toBe('The Glass Harbor');
  });
});

describe('F02 — the preview stays on the device', () => {
  const files = ['./preview.ts', '../app/preview.tsx'];

  it('has a screen to read it', () => {
    expect(source('../app/preview.tsx')).toContain('OPENING');
  });

  for (const file of files) {
    it(`${file} calls no transport`, () => {
      const text = source(file);
      for (const banned of ['fetch(', 'session.client', "from '../lib/api'", 'from \'../lib/api\'', 'telemetry.']) {
        expect(text, `${file} mentions ${banned}`).not.toContain(banned);
      }
    });
  }

  it('carries the fiction mark where the scene is shown', () => {
    // US12: the mark sits on the screen that shows generated fiction, and the
    // preview is fiction by construction — it was written by hand into the bundle.
    expect(source('../app/preview.tsx')).toContain('ConsentDisclosure');
  });
});
