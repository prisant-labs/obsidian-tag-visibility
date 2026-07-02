// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Plugin, View, WorkspaceLeaf } from 'obsidian';
import { NotebookNavigatorObserver } from '../src/observers/notebookNavigatorObserver';
import { Rule } from '../src/types';

// plugin-namespaced decoration classes / marker. Never nn-*.
const HIDDEN_CLASS = 'tc-nn-hidden';
const FLAG_CLASS = 'tc-nn-flagged';
const RULE_ATTR = 'data-tc-nn-rule';

// NN's leaf view type (mirrors how TagPaneObserver uses 'tag').
const NN_VIEW_TYPE = 'notebook-navigator-view';

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'r',
    name: 'r',
    enabled: true,
    priority: 50,
    match: { type: 'list', list: ['photo'] },
    action: 'hide',    ...overrides,
  };
}

/**
 * One NN tag row: div.nn-navitem.nn-tag with data-tag (canonical lowercase
 * path) and data-level, plus the inner name span NN renders. Mirrors
 * TagTreeItem.tsx:285-328 in shape (runtime-interop DOM contract only).
 */
function makeTagRow(dataTag: string, level = 0): HTMLElement {
  const row = document.createElement('div');
  row.className = 'nn-navitem nn-tag';
  row.setAttribute('data-tag', dataTag);
  row.setAttribute('data-level', String(level));
  row.setAttribute('role', 'treeitem');
  const content = document.createElement('div');
  content.className = 'nn-navitem-content';
  const name = document.createElement('span');
  name.className = 'nn-navitem-name';
  // NN shows only the leaf segment as the label.
  name.textContent = dataTag.split('/').pop() ?? dataTag;
  content.appendChild(name);
  row.appendChild(content);
  return row;
}

/**
 * The NN navigation pane scroll container the observer watches. Rows are
 * appended directly; the real NN nests them in virtual-item wrappers, but the
 * observer only cares about .nn-tag[data-tag] descendants of the scroller.
 */
function makeNnPane(rows: Array<[string, number]>): {
  pane: HTMLElement;
  scroller: HTMLElement;
} {
  const pane = document.createElement('div');
  pane.className = 'nn-navigation-pane';
  const scroller = document.createElement('div');
  scroller.className = 'nn-navigation-pane-scroller';
  scroller.setAttribute('data-pane', 'navigation');
  for (const [dataTag, level] of rows) {
    scroller.appendChild(makeTagRow(dataTag, level));
  }
  pane.appendChild(scroller);
  return { pane, scroller };
}

interface FakeWorkspace {
  onLayoutReady: (cb: () => void) => void;
  on: (event: string, cb: () => void) => { event: string; cb: () => void };
  getLeavesOfType: (type: string) => WorkspaceLeaf[];
}

function makeApp(containers: HTMLElement[]): {
  app: { workspace: FakeWorkspace };
  leaves: WorkspaceLeaf[];
} {
  const leaves: WorkspaceLeaf[] = containers.map(
    (c) => new WorkspaceLeaf(new View(c)),
  );
  const workspace: FakeWorkspace = {
    onLayoutReady: (cb) => cb(),
    on: (event, cb) => ({ event, cb }),
    getLeavesOfType: (type) => (type === NN_VIEW_TYPE ? leaves : []),
  };
  return { app: { workspace }, leaves };
}

function flushRaf(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function rowFor(scroller: HTMLElement, dataTag: string): HTMLElement {
  return scroller.querySelector<HTMLElement>(`.nn-tag[data-tag="${dataTag}"]`) as HTMLElement;
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

describe('NotebookNavigatorObserver basic decoration', () => {
  it('hides a row whose data-tag matches a hide rule', async () => {
    const { pane, scroller } = makeNnPane([
      ['photo', 0],
      ['other', 0],
    ]);
    document.body.appendChild(pane);
    const { app } = makeApp([pane]);
    const obs = new NotebookNavigatorObserver(app as never, new Plugin());
    obs.setRules([rule()]);
    obs.attachAll();
    await flushRaf();

    expect(rowFor(scroller, 'photo').classList.contains(HIDDEN_CLASS)).toBe(true);
    expect(rowFor(scroller, 'other').classList.contains(HIDDEN_CLASS)).toBe(false);
  });

  it('sets the data-tc-nn-rule marker on hidden rows', async () => {
    const { pane, scroller } = makeNnPane([['photo', 0]]);
    document.body.appendChild(pane);
    const { app } = makeApp([pane]);
    const obs = new NotebookNavigatorObserver(app as never, new Plugin());
    obs.setRules([rule({ id: 'hide-photo' })]);
    obs.attachAll();
    await flushRaf();

    expect(rowFor(scroller, 'photo').getAttribute(RULE_ATTR)).toBe('hide-photo');
  });

  it('never adds or removes nn-* classes', async () => {
    const { pane, scroller } = makeNnPane([['photo', 0]]);
    document.body.appendChild(pane);
    const { app } = makeApp([pane]);
    const obs = new NotebookNavigatorObserver(app as never, new Plugin());
    obs.setRules([rule()]);
    obs.attachAll();
    await flushRaf();

    const row = rowFor(scroller, 'photo');
    expect(row.classList.contains('nn-navitem')).toBe(true);
    expect(row.classList.contains('nn-tag')).toBe(true);
  });
});

describe('NotebookNavigatorObserver descendant match (flat nesting)', () => {
  it('a rule on "photo" also hides "photo/camera"', async () => {
    const { pane, scroller } = makeNnPane([
      ['photo', 0],
      ['photo/camera', 1],
      ['unrelated', 0],
    ]);
    document.body.appendChild(pane);
    const { app } = makeApp([pane]);
    const obs = new NotebookNavigatorObserver(app as never, new Plugin());
    obs.setRules([rule()]); // list ['photo']
    obs.attachAll();
    await flushRaf();

    expect(rowFor(scroller, 'photo').classList.contains(HIDDEN_CLASS)).toBe(true);
    expect(rowFor(scroller, 'photo/camera').classList.contains(HIDDEN_CLASS)).toBe(true);
    expect(rowFor(scroller, 'unrelated').classList.contains(HIDDEN_CLASS)).toBe(false);
  });

  it('does not hide a sibling that merely shares a prefix segment', async () => {
    // "photography" starts with "photo" but is NOT a descendant (no "/").
    const { pane, scroller } = makeNnPane([
      ['photo', 0],
      ['photography', 0],
    ]);
    document.body.appendChild(pane);
    const { app } = makeApp([pane]);
    const obs = new NotebookNavigatorObserver(app as never, new Plugin());
    obs.setRules([rule()]);
    obs.attachAll();
    await flushRaf();

    expect(rowFor(scroller, 'photo').classList.contains(HIDDEN_CLASS)).toBe(true);
    expect(rowFor(scroller, 'photography').classList.contains(HIDDEN_CLASS)).toBe(false);
  });

  it('an always-hide override on an ancestor propagates to its descendant', async () => {
    const { pane, scroller } = makeNnPane([
      ['photo', 0],
      ['photo/camera', 1],
    ]);
    document.body.appendChild(pane);
    const { app } = makeApp([pane]);
    const obs = new NotebookNavigatorObserver(app as never, new Plugin());
    // No rules - the hide comes purely from the always-hide override on the ancestor.
    obs.setRules([]);
    obs.setOverrides({ photo: 'hide' });
    obs.attachAll();
    await flushRaf();

    expect(rowFor(scroller, 'photo').classList.contains(HIDDEN_CLASS)).toBe(true);
    expect(rowFor(scroller, 'photo/camera').classList.contains(HIDDEN_CLASS)).toBe(true);
  });

  it('an always-show override on the descendant beats an ancestor hide', async () => {
    const { pane, scroller } = makeNnPane([
      ['photo', 0],
      ['photo/camera', 1],
    ]);
    document.body.appendChild(pane);
    const { app } = makeApp([pane]);
    const obs = new NotebookNavigatorObserver(app as never, new Plugin());
    obs.setRules([rule()]);
    obs.setOverrides({ 'photo/camera': 'show' });
    obs.attachAll();
    await flushRaf();

    expect(rowFor(scroller, 'photo').classList.contains(HIDDEN_CLASS)).toBe(true);
    expect(rowFor(scroller, 'photo/camera').classList.contains(HIDDEN_CLASS)).toBe(false);
  });
});

describe('NotebookNavigatorObserver idempotency', () => {
  it('re-running apply does not double-decorate', async () => {
    const { pane, scroller } = makeNnPane([['photo', 0]]);
    document.body.appendChild(pane);
    const { app } = makeApp([pane]);
    const obs = new NotebookNavigatorObserver(app as never, new Plugin());
    obs.setRules([rule()]);
    obs.attachAll();
    await flushRaf();
    // Force a second decorate pass.
    obs.setRules([rule()]);
    await flushRaf();

    const row = rowFor(scroller, 'photo');
    const hiddenCount = Array.from(row.classList).filter(
      (c) => c === HIDDEN_CLASS,
    ).length;
    expect(hiddenCount).toBe(1);
    // classList is a set, but also assert the row appears once in a query.
    expect(scroller.querySelectorAll(`.${HIDDEN_CLASS}`).length).toBe(1);
  });

  it('idempotent observeContainer (attaching twice = one cleanup)', async () => {
    const { pane } = makeNnPane([['photo', 0]]);
    document.body.appendChild(pane);
    const { app } = makeApp([pane]);
    const plugin = new Plugin();
    const obs = new NotebookNavigatorObserver(app as never, plugin);
    obs.setRules([rule()]);
    obs.attachAll();
    obs.attachAll();
    await flushRaf();

    expect(plugin.registeredCleanups.length).toBe(1);
  });
});

describe('NotebookNavigatorObserver re-decoration after removal + reinsert', () => {
  it('re-decorates a fresh node that replaces a removed row (virtualization path)', async () => {
    const { pane, scroller } = makeNnPane([['photo', 0]]);
    document.body.appendChild(pane);
    const { app } = makeApp([pane]);
    const obs = new NotebookNavigatorObserver(app as never, new Plugin());
    obs.setRules([rule()]);
    obs.attachAll();
    await flushRaf();
    expect(rowFor(scroller, 'photo').classList.contains(HIDDEN_CLASS)).toBe(true);

    // Simulate TanStack unmounting then remounting the row as a fresh,
    // undecorated node (scroll out of view, then back in).
    scroller.querySelector('.nn-tag[data-tag="photo"]')?.remove();
    const fresh = makeTagRow('photo', 0);
    scroller.appendChild(fresh);
    expect(fresh.classList.contains(HIDDEN_CLASS)).toBe(false);

    // The inherited MutationObserver schedules a re-decorate on insertion.
    await flushRaf();
    expect(fresh.classList.contains(HIDDEN_CLASS)).toBe(true);
  });
});

describe('NotebookNavigatorObserver preview mode', () => {
  it('flags instead of hides when previewMode is on', async () => {
    const { pane, scroller } = makeNnPane([
      ['photo', 0],
      ['photo/camera', 1],
    ]);
    document.body.appendChild(pane);
    const { app } = makeApp([pane]);
    const obs = new NotebookNavigatorObserver(app as never, new Plugin());
    obs.setRules([rule()]);
    obs.setPreviewMode(true);
    obs.attachAll();
    await flushRaf();

    const parent = rowFor(scroller, 'photo');
    const child = rowFor(scroller, 'photo/camera');
    expect(parent.classList.contains(FLAG_CLASS)).toBe(true);
    expect(parent.classList.contains(HIDDEN_CLASS)).toBe(false);
    // Descendant match also flags in preview mode.
    expect(child.classList.contains(FLAG_CLASS)).toBe(true);
    expect(child.classList.contains(HIDDEN_CLASS)).toBe(false);
  });
});

describe('NotebookNavigatorObserver clear-on-unload', () => {
  it('unload removes every tc-nn-* class and the data-tc-nn-rule marker', async () => {
    const { pane, scroller } = makeNnPane([
      ['photo', 0],
      ['photo/camera', 1],
    ]);
    document.body.appendChild(pane);
    const { app } = makeApp([pane]);
    const obs = new NotebookNavigatorObserver(app as never, new Plugin());
    obs.setRules([rule()]);
    obs.attachAll();
    await flushRaf();

    obs.unload();

    for (const dataTag of ['photo', 'photo/camera']) {
      const row = rowFor(scroller, dataTag);
      expect(row.classList.contains(HIDDEN_CLASS)).toBe(false);
      expect(row.classList.contains(FLAG_CLASS)).toBe(false);
      expect(row.hasAttribute(RULE_ATTR)).toBe(false);
      // nn-* classes are untouched.
      expect(row.classList.contains('nn-tag')).toBe(true);
    }
  });

  it('setEnabled(false) strips all tc-nn-* decoration', async () => {
    const { pane, scroller } = makeNnPane([['photo', 0]]);
    document.body.appendChild(pane);
    const { app } = makeApp([pane]);
    const obs = new NotebookNavigatorObserver(app as never, new Plugin());
    obs.setRules([rule()]);
    obs.attachAll();
    await flushRaf();

    obs.setEnabled(false);

    const row = rowFor(scroller, 'photo');
    expect(row.classList.contains(HIDDEN_CLASS)).toBe(false);
    expect(row.hasAttribute(RULE_ATTR)).toBe(false);
  });
});

/**
 * Mutation delivery + the coalesced apply: MutationObserver callbacks fire on
 * a task boundary in happy-dom, then scheduleApply queues a (stubbed,
 * microtask) rAF pass, and re-decoration may fire one follow-on pass. Flush
 * all three.
 */
async function flushMutations(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushRaf();
  await flushRaf();
}

describe('NotebookNavigatorObserver survives host re-renders (React className wipe)', () => {
  it('re-decorates a row whose class attribute was rewritten in place', async () => {
    const { pane, scroller } = makeNnPane([['photo', 0]]);
    document.body.appendChild(pane);
    const { app } = makeApp([pane]);
    const obs = new NotebookNavigatorObserver(app as never, new Plugin());
    obs.setRules([rule({ id: 'hide-photo' })]);
    obs.attachAll();
    await flushRaf();

    const row = rowFor(scroller, 'photo');
    expect(row.classList.contains(HIDDEN_CLASS)).toBe(true);

    // Simulate NN's React reconciliation on click/selection: it rewrites the
    // row's className from its own vDOM, wiping foreign classes IN PLACE (an
    // attribute mutation - no childList or characterData change fires).
    row.className = 'nn-navitem nn-tag nn-selected';
    expect(row.classList.contains(HIDDEN_CLASS)).toBe(false);

    await flushMutations();

    expect(row.classList.contains(HIDDEN_CLASS)).toBe(true);
    expect(row.getAttribute(RULE_ATTR)).toBe('hide-photo');
    // NN's own classes are preserved by the repair.
    expect(row.classList.contains('nn-selected')).toBe(true);
  });
});

describe('NotebookNavigatorObserver dim-in-place (Approach A)', () => {
  it('keeps hidden rows aria-visible: dimmed and struck through, not removed', async () => {
    const { pane, scroller } = makeNnPane([['photo', 0]]);
    document.body.appendChild(pane);
    const { app } = makeApp([pane]);
    const obs = new NotebookNavigatorObserver(app as never, new Plugin());
    obs.setRules([rule()]);
    obs.attachAll();
    await flushRaf();

    const row = rowFor(scroller, 'photo');
    expect(row.classList.contains(HIDDEN_CLASS)).toBe(true);
    // NN's committed-offset virtualizer keeps the row's slot forever, so the
    // shipped hidden treatment is dim + strikethrough: the row stays visible
    // and interactive. aria-hidden on visible interactive content would be an
    // accessibility violation, so the hidden mode must NOT set it here.
    expect(row.hasAttribute('aria-hidden')).toBe(false);
  });
});
