// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { panicCleanup } from '../src/ui/panicDisable';

/**
 * Locks the "panic clears everything across all scopes" contract (Phase 10).
 *
 * Tag Visibility owns four decoration namespaces - the core tag pane
 * (tag-curator-*), Notebook Navigator (tc-nn-*), Properties (tc-prop-*), and the
 * editor autocomplete (tc-ac-*). panicCleanup(document) must strip EVERY scope's
 * classes AND data-*-rule attrs, plus the aria-hidden each decoration sets, so a
 * stale scope can never leave a row hidden after the panic command. If a future
 * scope's class/attr is added to the engine but not to panicDisable's sweep
 * lists, this test fails.
 */

// Every decoration class panic must strip, one per scope x mode (hidden /
// flagged / marked).
const SCOPE_CLASSES = [
  'tag-curator-hidden',
  'tag-curator-flagged',
  'tag-curator-marked',
  'tc-nn-hidden',
  'tc-nn-flagged',
  'tc-nn-marked',
  'tc-prop-hidden',
  'tc-prop-flagged',
  'tc-prop-marked',
  'tc-ac-hidden',
  'tc-ac-flagged',
  'tc-ac-marked',
];

// Every data-*-rule attr panic must strip, one per scope.
const SCOPE_ATTRS = [
  'data-tag-curator-rule',
  'data-tc-nn-rule',
  'data-tc-prop-rule',
  'data-tc-ac-rule',
];

/** Build one decorated element per scope class, each also aria-hidden. */
function seedDecoratedClasses(doc: Document): HTMLElement[] {
  return SCOPE_CLASSES.map((cls) => {
    const el = doc.createElement('div');
    el.classList.add(cls);
    el.setAttribute('aria-hidden', 'true');
    doc.body.appendChild(el);
    return el;
  });
}

/** Build one element per scope data-*-rule attr, each also aria-hidden. */
function seedDecoratedAttrs(doc: Document): HTMLElement[] {
  return SCOPE_ATTRS.map((attr) => {
    const el = doc.createElement('div');
    el.setAttribute(attr, 'some-rule-id');
    el.setAttribute('aria-hidden', 'true');
    doc.body.appendChild(el);
    return el;
  });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('panicCleanup', () => {
  it('strips every scope decoration class and clears its aria-hidden', () => {
    const els = seedDecoratedClasses(document);

    panicCleanup(document);

    for (const el of els) {
      for (const cls of SCOPE_CLASSES) {
        expect(el.classList.contains(cls)).toBe(false);
      }
      expect(el.hasAttribute('aria-hidden')).toBe(false);
    }
    // No element anywhere in the document still carries a scope class.
    for (const cls of SCOPE_CLASSES) {
      expect(document.querySelectorAll(`.${cls}`).length).toBe(0);
    }
  });

  it('strips every scope data-*-rule attr and clears its aria-hidden', () => {
    const els = seedDecoratedAttrs(document);

    panicCleanup(document);

    for (const el of els) {
      for (const attr of SCOPE_ATTRS) {
        expect(el.hasAttribute(attr)).toBe(false);
      }
      expect(el.hasAttribute('aria-hidden')).toBe(false);
    }
    for (const attr of SCOPE_ATTRS) {
      expect(document.querySelectorAll(`[${attr}]`).length).toBe(0);
    }
  });

  it('clears a single element carrying classes AND attrs from multiple scopes', () => {
    // A worst case: one row decorated by every scope at once. Panic must leave
    // it pristine (no scope class, no data-*-rule attr, no aria-hidden).
    const el = document.createElement('div');
    for (const cls of SCOPE_CLASSES) el.classList.add(cls);
    for (const attr of SCOPE_ATTRS) el.setAttribute(attr, 'r');
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);

    panicCleanup(document);

    for (const cls of SCOPE_CLASSES) {
      expect(el.classList.contains(cls)).toBe(false);
    }
    for (const attr of SCOPE_ATTRS) {
      expect(el.hasAttribute(attr)).toBe(false);
    }
    expect(el.hasAttribute('aria-hidden')).toBe(false);
  });

  it('is a no-op on an undecorated document', () => {
    const el = document.createElement('div');
    el.classList.add('some-unrelated-class');
    el.setAttribute('aria-hidden', 'true'); // pre-existing, not ours
    document.body.appendChild(el);

    expect(() => panicCleanup(document)).not.toThrow();
    // We only clear aria-hidden on elements we actually decorated, so an
    // unrelated element keeps its own class. (Its aria-hidden is untouched
    // because it carried no scope class or attr.)
    expect(el.classList.contains('some-unrelated-class')).toBe(true);
    expect(el.hasAttribute('aria-hidden')).toBe(true);
  });
});
