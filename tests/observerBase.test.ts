// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, Plugin } from 'obsidian';
import {
  DecorationMode,
  ObservedRow,
  ObserverBase,
} from '../src/observers/observerBase';
import { Rule } from '../src/types';

const DEC_HIDDEN = 'dec-hidden';
const DEC_FLAG = 'dec-flagged';

/**
 * Minimal concrete observer used to exercise the base contract independently of
 * any real host surface. Rows are `.row` elements whose tag is their text; the
 * decoration is a simple class. This is also the reference shape a future
 * Notebook Navigator observer follows.
 */
class TestObserver extends ObserverBase {
  init(): void {
    /* containers are attached explicitly in tests via attach() */
  }

  attach(el: HTMLElement): void {
    this.observeContainer(el);
  }

  attachAll(): void {
    /* tests attach containers explicitly via attach(); nothing to discover */
  }

  protected findRows(root: HTMLElement): ObservedRow[] {
    return Array.from(root.querySelectorAll<HTMLElement>('.row')).map((el) => ({
      el,
      tag: (el.textContent ?? '').trim(),
    }));
  }

  protected applyDecoration(
    el: HTMLElement,
    _ruleId: string,
    mode: DecorationMode,
  ): void {
    el.classList.add(mode === 'hidden' ? DEC_HIDDEN : DEC_FLAG);
    el.classList.remove(mode === 'hidden' ? DEC_FLAG : DEC_HIDDEN);
  }

  protected clearDecoration(el: HTMLElement): void {
    el.classList.remove(DEC_HIDDEN, DEC_FLAG);
  }

  protected findDecorated(root: HTMLElement): HTMLElement[] {
    return Array.from(
      root.querySelectorAll<HTMLElement>(`.${DEC_HIDDEN}, .${DEC_FLAG}`),
    );
  }
}

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'r',
    name: 'r',
    enabled: true,
    priority: 50,
    match: { type: 'list', list: ['t'] },
    action: 'hide',    ...overrides,
  };
}

function makeContainer(tags: string[]): HTMLElement {
  const c = document.createElement('div');
  for (const t of tags) {
    const row = document.createElement('div');
    row.className = 'row';
    row.textContent = t;
    c.appendChild(row);
  }
  return c;
}

function flushRaf(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function newObserver(plugin: Plugin = new Plugin()): TestObserver {
  return new TestObserver({} as unknown as App, plugin);
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    queueMicrotask(() => cb(performance.now()));
    return 0 as unknown as number;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('ObserverBase', () => {
  it('decorates matching rows hidden and leaves others alone', async () => {
    const c = makeContainer(['t', 'other']);
    document.body.appendChild(c);
    const obs = newObserver();
    obs.setRules([rule()]);
    obs.attach(c);
    await flushRaf();

    const rows = c.querySelectorAll('.row');
    expect(rows[0].classList.contains(DEC_HIDDEN)).toBe(true);
    expect(rows[1].classList.contains(DEC_HIDDEN)).toBe(false);
  });

  it('flags instead of hides in preview mode', async () => {
    const c = makeContainer(['t']);
    document.body.appendChild(c);
    const obs = newObserver();
    obs.setRules([rule()]);
    obs.setPreviewMode(true);
    obs.attach(c);
    await flushRaf();

    const row = c.querySelector('.row') as HTMLElement;
    expect(row.classList.contains(DEC_FLAG)).toBe(true);
    expect(row.classList.contains(DEC_HIDDEN)).toBe(false);
  });

  it('observeContainer is idempotent (one cleanup per container)', async () => {
    const c = makeContainer(['t']);
    document.body.appendChild(c);
    const plugin = new Plugin();
    const obs = newObserver(plugin);
    obs.setRules([rule()]);
    obs.attach(c);
    obs.attach(c);
    await flushRaf();

    expect(plugin.registeredCleanups.length).toBe(1);
  });

  it('setEnabled(false) clears decorations synchronously', async () => {
    const c = makeContainer(['t']);
    document.body.appendChild(c);
    const obs = newObserver();
    obs.setRules([rule()]);
    obs.attach(c);
    await flushRaf();

    obs.setEnabled(false);
    expect((c.querySelector('.row') as HTMLElement).classList.contains(DEC_HIDDEN)).toBe(false);
  });

  it('strips a leading hash before matching', async () => {
    const c = makeContainer(['#t']);
    document.body.appendChild(c);
    const obs = newObserver();
    obs.setRules([rule()]);
    obs.attach(c);
    await flushRaf();

    expect((c.querySelector('.row') as HTMLElement).classList.contains(DEC_HIDDEN)).toBe(true);
  });

  it('unload clears decorations', async () => {
    const c = makeContainer(['t']);
    document.body.appendChild(c);
    const obs = newObserver();
    obs.setRules([rule()]);
    obs.attach(c);
    await flushRaf();

    obs.unload();
    expect((c.querySelector('.row') as HTMLElement).classList.contains(DEC_HIDDEN)).toBe(false);
  });

  it('an always-show override un-hides a rule-matched row', async () => {
    const c = makeContainer(['t']);
    document.body.appendChild(c);
    const obs = newObserver();
    obs.setRules([rule()]);
    obs.setOverrides({ t: 'show' });
    obs.attach(c);
    await flushRaf();

    expect((c.querySelector('.row') as HTMLElement).classList.contains(DEC_HIDDEN)).toBe(false);
  });

  it('an always-hide override hides an unmatched row', async () => {
    const c = makeContainer(['other']);
    document.body.appendChild(c);
    const obs = newObserver();
    obs.setRules([rule()]);
    obs.setOverrides({ other: 'hide' });
    obs.attach(c);
    await flushRaf();

    expect((c.querySelector('.row') as HTMLElement).classList.contains(DEC_HIDDEN)).toBe(true);
  });

  it('an always-hide override flags (not hides) an unmatched row in preview mode', async () => {
    const c = makeContainer(['other']);
    document.body.appendChild(c);
    const obs = newObserver();
    obs.setRules([rule()]);
    obs.setPreviewMode(true);
    obs.setOverrides({ other: 'hide' });
    obs.attach(c);
    await flushRaf();

    const row = c.querySelector('.row') as HTMLElement;
    expect(row.classList.contains(DEC_FLAG)).toBe(true);
    expect(row.classList.contains(DEC_HIDDEN)).toBe(false);
  });

  it('re-applies when a row is recycled via an in-place text change', async () => {
    // Virtualized panes (the core tag pane, Notebook Navigator) recycle row
    // elements by mutating their text in place rather than adding/removing
    // nodes. The observer must catch characterData mutations, or a recycled
    // row keeps the decoration of whatever tag it previously showed.
    const c = makeContainer(['other']);
    document.body.appendChild(c);
    const obs = newObserver();
    obs.setRules([rule()]);
    obs.attach(c);
    await flushRaf();

    const row = c.querySelector('.row') as HTMLElement;
    expect(row.classList.contains(DEC_HIDDEN)).toBe(false);

    // Recycle the row to a rule-matched tag by editing the text node in place
    // (a characterData mutation, no childList change).
    (row.firstChild as Text).data = 't';
    await flushRaf();
    await flushRaf();

    expect(row.classList.contains(DEC_HIDDEN)).toBe(true);
  });

  it('evicts a detached container and re-observes it if the host re-attaches it (DA-10)', async () => {
    const c = makeContainer(['t']);
    document.body.appendChild(c);
    const obs = newObserver();
    obs.setRules([rule()]);
    obs.attach(c);
    await flushRaf();
    expect((c.querySelector('.row') as HTMLElement).classList.contains(DEC_HIDDEN)).toBe(true);

    // Close the pane: the container detaches. The next pass must evict it
    // (disconnect + forget) instead of re-walking the dead subtree forever.
    c.remove();
    obs.setRules([rule()]);
    await flushRaf();

    // Prove the observer no longer manages the detached tree: strip the
    // decoration by hand, trigger another pass, and expect no re-decoration.
    (c.querySelector('.row') as HTMLElement).classList.remove(DEC_HIDDEN);
    obs.setRules([rule()]);
    await flushRaf();
    expect((c.querySelector('.row') as HTMLElement).classList.contains(DEC_HIDDEN)).toBe(false);

    // The host brings the same element back (leaf re-attached): the dedupe
    // entry must have been evicted too, so re-observation works and decorates.
    document.body.appendChild(c);
    obs.attach(c);
    await flushRaf();
    expect((c.querySelector('.row') as HTMLElement).classList.contains(DEC_HIDDEN)).toBe(true);
  });
});
