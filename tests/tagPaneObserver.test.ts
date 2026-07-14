// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Plugin, View, WorkspaceLeaf } from 'obsidian';
import { TagPaneObserver } from '../src/observers/tagPaneObserver';
import { Rule, TagMeta } from '../src/types';

const HIDDEN_CLASS = 'tag-curator-hidden';
const FLAG_CLASS = 'tag-curator-flagged';
const MARK_CLASS = 'tag-curator-marked';
const TAG_ATTR = 'data-tag-curator-rule';
const TAG_VIEW_TYPE = 'tag';

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

function meta(tag: string, count: number): TagMeta {
  return {
    tag,
    firstSeen: 0,
    lastSeen: 0,
    count,
    sources: ['inline'],
  };
}

function makeTagRow(tag: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'tag-pane-tag';
  const text = document.createElement('span');
  text.className = 'tag-pane-tag-text';
  text.textContent = tag;
  row.appendChild(text);
  return row;
}

function makeTagPane(tags: string[]): HTMLElement {
  const container = document.createElement('div');
  container.className = 'tag-pane';
  for (const t of tags) container.appendChild(makeTagRow(t));
  return container;
}

/**
 * Build a row matching the CURRENT Obsidian tag pane DOM (a generic tree-item):
 * the tag text lives in `.tree-item-inner-text`, and the usage count is a
 * sibling `.tag-pane-tag-count` flair OUTSIDE the text node. Reading the whole
 * row's textContent therefore glues the count onto the tag ("0FA9EA" + "89").
 * The legacy `.tag-pane-tag-text` class is gone. Captured from a live vault.
 */
function makeTreeItemTagRow(tag: string, count: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'tree-item-self tag-pane-tag is-clickable';

  const inner = document.createElement('div');
  inner.className = 'tree-item-inner';
  const innerText = document.createElement('div');
  innerText.className = 'tree-item-inner-text';
  const parent = document.createElement('span');
  parent.className = 'tag-pane-tag-parent';
  const leaf = document.createElement('span');
  leaf.className = 'tree-item-inner-text';
  leaf.textContent = tag;
  innerText.append(parent, leaf);
  inner.appendChild(innerText);

  const flairOuter = document.createElement('div');
  flairOuter.className = 'tree-item-flair-outer';
  const flair = document.createElement('span');
  flair.className = 'tag-pane-tag-count tree-item-flair';
  flair.textContent = String(count);
  flairOuter.appendChild(flair);

  row.append(inner, flairOuter);
  return row;
}

function makeTreeItemTagPane(tags: Array<[string, number]>): HTMLElement {
  const container = document.createElement('div');
  container.className = 'tag-pane';
  for (const [t, c] of tags) container.appendChild(makeTreeItemTagRow(t, c));
  return container;
}

interface FakeWorkspace {
  onLayoutReady: (cb: () => void) => void;
  on: (event: string, cb: () => void) => { event: string; cb: () => void };
  getLeavesOfType: (type: string) => WorkspaceLeaf[];
}

function makeApp(containers: HTMLElement[]): { app: { workspace: FakeWorkspace }; leaves: WorkspaceLeaf[] } {
  const leaves: WorkspaceLeaf[] = containers.map((c) => new WorkspaceLeaf(new View(c)));
  const workspace: FakeWorkspace = {
    onLayoutReady: (cb) => cb(),
    on: (event, cb) => ({ event, cb }),
    getLeavesOfType: (type) => (type === TAG_VIEW_TYPE ? leaves : []),
  };
  return { app: { workspace }, leaves };
}

function flushRaf(): Promise<void> {
  // The observer uses requestAnimationFrame to coalesce apply() calls. Resolve
  // a microtask first so any pending scheduleApply has run, then advance rAF.
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

beforeEach(() => {
  // Provide a deterministic requestAnimationFrame that runs the callback on a
  // microtask. JSDOM has its own implementation but the timing is unreliable
  // across versions.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    queueMicrotask(() => cb(performance.now()));
    return 0 as unknown as number;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('TagPaneObserver.attachAll', () => {
  it('attaches to a single tag pane and applies hide class', async () => {
    const container = makeTagPane(['t', 'other']);
    document.body.appendChild(container);
    const { app } = makeApp([container]);
    const plugin = new Plugin();

    const obs = new TagPaneObserver(app as unknown as Parameters<typeof TagPaneObserver.prototype['init']> extends never ? never : never, plugin);
    obs.setRules([rule()]);
    obs.attachAll();
    await flushRaf();

    const rows = container.querySelectorAll('.tag-pane-tag');
    expect(rows[0].classList.contains(HIDDEN_CLASS)).toBe(true);
    expect(rows[1].classList.contains(HIDDEN_CLASS)).toBe(false);
  });

  it('attaches to multiple tag panes', async () => {
    const a = makeTagPane(['t']);
    const b = makeTagPane(['t']);
    document.body.appendChild(a);
    document.body.appendChild(b);
    const { app } = makeApp([a, b]);
    const plugin = new Plugin();

    const obs = new TagPaneObserver(app as never, plugin);
    obs.setRules([rule()]);
    obs.attachAll();
    await flushRaf();

    expect(a.querySelector('.tag-pane-tag')?.classList.contains(HIDDEN_CLASS)).toBe(true);
    expect(b.querySelector('.tag-pane-tag')?.classList.contains(HIDDEN_CLASS)).toBe(true);
  });

  it('is idempotent (attaching twice does not double-observe)', async () => {
    const container = makeTagPane(['t']);
    document.body.appendChild(container);
    const { app } = makeApp([container]);
    const plugin = new Plugin();

    const obs = new TagPaneObserver(app as never, plugin);
    obs.setRules([rule()]);
    obs.attachAll();
    obs.attachAll();
    await flushRaf();

    expect(plugin.registeredCleanups.length).toBe(1);
  });
});

describe('TagPaneObserver.apply', () => {
  it('sets aria-hidden and data-tag-curator-rule on hidden rows', async () => {
    const container = makeTagPane(['t']);
    document.body.appendChild(container);
    const { app } = makeApp([container]);
    const obs = new TagPaneObserver(app as never, new Plugin());
    obs.setRules([rule({ id: 'orphans' })]);
    obs.attachAll();
    await flushRaf();

    const row = container.querySelector('.tag-pane-tag') as HTMLElement;
    expect(row.getAttribute('aria-hidden')).toBe('true');
    expect(row.getAttribute(TAG_ATTR)).toBe('orphans');
  });

  it('clears classes and attributes when a rule stops matching', async () => {
    const container = makeTagPane(['t']);
    document.body.appendChild(container);
    const { app } = makeApp([container]);
    const obs = new TagPaneObserver(app as never, new Plugin());
    obs.setRules([rule()]);
    obs.attachAll();
    await flushRaf();

    obs.setRules([]); // no rules now
    await flushRaf();

    const row = container.querySelector('.tag-pane-tag') as HTMLElement;
    expect(row.classList.contains(HIDDEN_CLASS)).toBe(false);
    expect(row.hasAttribute('aria-hidden')).toBe(false);
    expect(row.hasAttribute(TAG_ATTR)).toBe(false);
  });

  it('strips a leading hash when matching against tag text', async () => {
    const container = makeTagPane(['#t']); // tag-pane often renders with leading #
    document.body.appendChild(container);
    const { app } = makeApp([container]);
    const obs = new TagPaneObserver(app as never, new Plugin());
    obs.setRules([rule()]); // matches list ['t'] (without hash)
    obs.attachAll();
    await flushRaf();

    const row = container.querySelector('.tag-pane-tag') as HTMLElement;
    expect(row.classList.contains(HIDDEN_CLASS)).toBe(true);
  });

  it('feeds tag metadata to frequency rules', async () => {
    const container = makeTagPane(['orphan']);
    document.body.appendChild(container);
    const { app } = makeApp([container]);
    const obs = new TagPaneObserver(app as never, new Plugin());

    const orphanRule = rule({
      id: 'orphan-rule',
      match: { type: 'frequency', operator: '<=', value: 1 },
    });
    obs.setRules([orphanRule]);
    obs.setMetadata(new Map([['orphan', meta('orphan', 1)]]));
    obs.attachAll();
    await flushRaf();

    const row = container.querySelector('.tag-pane-tag') as HTMLElement;
    expect(row.classList.contains(HIDDEN_CLASS)).toBe(true);
  });

  it('skips rows with empty tag text', async () => {
    const container = document.createElement('div');
    const row = document.createElement('div');
    row.className = 'tag-pane-tag';
    const text = document.createElement('span');
    text.className = 'tag-pane-tag-text';
    text.textContent = '   ';
    row.appendChild(text);
    container.appendChild(row);
    document.body.appendChild(container);

    const { app } = makeApp([container]);
    const obs = new TagPaneObserver(app as never, new Plugin());
    obs.setRules([rule()]);
    obs.attachAll();
    await flushRaf();

    expect(row.classList.contains(HIDDEN_CLASS)).toBe(false);
  });
});

describe('TagPaneObserver preview mode', () => {
  it('adds FLAG_CLASS instead of HIDDEN_CLASS when previewMode is true', async () => {
    const container = makeTagPane(['t']);
    document.body.appendChild(container);
    const { app } = makeApp([container]);
    const obs = new TagPaneObserver(app as never, new Plugin());
    obs.setRules([rule()]);
    obs.setPreviewMode(true);
    obs.attachAll();
    await flushRaf();

    const row = container.querySelector('.tag-pane-tag') as HTMLElement;
    expect(row.classList.contains(FLAG_CLASS)).toBe(true);
    expect(row.classList.contains(HIDDEN_CLASS)).toBe(false);
    expect(row.hasAttribute('aria-hidden')).toBe(false);
    expect(row.getAttribute(TAG_ATTR)).toBe('r');
  });

  it('swaps from FLAG to HIDDEN when previewMode is turned off', async () => {
    const container = makeTagPane(['t']);
    document.body.appendChild(container);
    const { app } = makeApp([container]);
    const obs = new TagPaneObserver(app as never, new Plugin());
    obs.setRules([rule()]);
    obs.setPreviewMode(true);
    obs.attachAll();
    await flushRaf();

    obs.setPreviewMode(false);
    await flushRaf();

    const row = container.querySelector('.tag-pane-tag') as HTMLElement;
    expect(row.classList.contains(HIDDEN_CLASS)).toBe(true);
    expect(row.classList.contains(FLAG_CLASS)).toBe(false);
    expect(row.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('TagPaneObserver flag action', () => {
  it('marks a flag-rule tag (visible), not hidden, in normal mode', async () => {
    const container = makeTagPane(['t']);
    document.body.appendChild(container);
    const { app } = makeApp([container]);
    const obs = new TagPaneObserver(app as never, new Plugin());
    obs.setRules([rule({ action: 'flag' })]);
    obs.attachAll();
    await flushRaf();

    const row = container.querySelector('.tag-pane-tag') as HTMLElement;
    expect(row.classList.contains(MARK_CLASS)).toBe(true);
    expect(row.classList.contains(HIDDEN_CLASS)).toBe(false);
    expect(row.hasAttribute('aria-hidden')).toBe(false); // marked stays visible
    expect(row.getAttribute(TAG_ATTR)).toBe('r');
  });

  it('keeps the flag mark in preview mode (preview-independent)', async () => {
    const container = makeTagPane(['t']);
    document.body.appendChild(container);
    const { app } = makeApp([container]);
    const obs = new TagPaneObserver(app as never, new Plugin());
    obs.setRules([rule({ action: 'flag' })]);
    obs.setPreviewMode(true);
    obs.attachAll();
    await flushRaf();

    const row = container.querySelector('.tag-pane-tag') as HTMLElement;
    expect(row.classList.contains(MARK_CLASS)).toBe(true);
    expect(row.classList.contains(FLAG_CLASS)).toBe(false);
  });
});

describe('TagPaneObserver.setEnabled', () => {
  it('false strips all hide/flag classes and attributes', async () => {
    const container = makeTagPane(['t']);
    document.body.appendChild(container);
    const { app } = makeApp([container]);
    const obs = new TagPaneObserver(app as never, new Plugin());
    obs.setRules([rule()]);
    obs.attachAll();
    await flushRaf();

    obs.setEnabled(false);

    const row = container.querySelector('.tag-pane-tag') as HTMLElement;
    expect(row.classList.contains(HIDDEN_CLASS)).toBe(false);
    expect(row.hasAttribute('aria-hidden')).toBe(false);
    expect(row.hasAttribute(TAG_ATTR)).toBe(false);
  });

  it('true re-applies after a disable', async () => {
    const container = makeTagPane(['t']);
    document.body.appendChild(container);
    const { app } = makeApp([container]);
    const obs = new TagPaneObserver(app as never, new Plugin());
    obs.setRules([rule()]);
    obs.attachAll();
    await flushRaf();
    obs.setEnabled(false);
    obs.setEnabled(true);
    await flushRaf();

    const row = container.querySelector('.tag-pane-tag') as HTMLElement;
    expect(row.classList.contains(HIDDEN_CLASS)).toBe(true);
  });
});

describe('TagPaneObserver counts and lookups', () => {
  it('countHidden reflects hidden rows across panes', async () => {
    const a = makeTagPane(['t', 'other']);
    const b = makeTagPane(['t']);
    document.body.appendChild(a);
    document.body.appendChild(b);
    const { app } = makeApp([a, b]);
    const obs = new TagPaneObserver(app as never, new Plugin());
    obs.setRules([rule()]);
    obs.attachAll();
    await flushRaf();

    expect(obs.countHidden()).toBe(2);
  });

  it('countFlagged reflects flagged rows in preview mode', async () => {
    const a = makeTagPane(['t', 't', 'other']);
    document.body.appendChild(a);
    const { app } = makeApp([a]);
    const obs = new TagPaneObserver(app as never, new Plugin());
    obs.setRules([rule()]);
    obs.setPreviewMode(true);
    obs.attachAll();
    await flushRaf();

    expect(obs.countFlagged()).toBe(2);
    expect(obs.countHidden()).toBe(0);
  });

  it('ruleForElement returns the ruleId set on the row', async () => {
    const container = makeTagPane(['t']);
    document.body.appendChild(container);
    const { app } = makeApp([container]);
    const obs = new TagPaneObserver(app as never, new Plugin());
    obs.setRules([rule({ id: 'my-rule' })]);
    obs.attachAll();
    await flushRaf();

    const row = container.querySelector('.tag-pane-tag') as HTMLElement;
    expect(obs.ruleForElement(row)).toBe('my-rule');
  });
});

describe('TagPaneObserver.clearAll / unload', () => {
  it('clearAll removes hide/flag from every attached container', async () => {
    const a = makeTagPane(['t']);
    const b = makeTagPane(['t']);
    document.body.appendChild(a);
    document.body.appendChild(b);
    const { app } = makeApp([a, b]);
    const obs = new TagPaneObserver(app as never, new Plugin());
    obs.setRules([rule()]);
    obs.attachAll();
    await flushRaf();

    obs.clearAll();
    expect(a.querySelector('.tag-pane-tag')?.classList.contains(HIDDEN_CLASS)).toBe(false);
    expect(b.querySelector('.tag-pane-tag')?.classList.contains(HIDDEN_CLASS)).toBe(false);
  });

  it('unload clears DOM and forgets containers', async () => {
    const container = makeTagPane(['t']);
    document.body.appendChild(container);
    const { app } = makeApp([container]);
    const obs = new TagPaneObserver(app as never, new Plugin());
    obs.setRules([rule()]);
    obs.attachAll();
    await flushRaf();

    obs.unload();
    expect(container.querySelector('.tag-pane-tag')?.classList.contains(HIDDEN_CLASS)).toBe(false);
    expect(obs.countHidden()).toBe(0);
  });
});

describe('TagPaneObserver reads the current Obsidian tag-pane DOM', () => {
  const hexRule = (): Rule =>
    rule({ id: 'hide-hex-codes', match: { type: 'regex', pattern: '^[0-9A-Fa-f]{3,8}$' } });

  it('hides a hex tag whose row carries a count flair (the count must not corrupt the tag)', async () => {
    // Regression: "D157FA" used 111 times. Reading the whole row yields
    // "D157FA111" (9 chars), which exceeds the 3-8 hex pattern and leaks the
    // tag. (A 2-digit count stays <= 8 chars and still matches by luck, which is
    // why only frequently-used hex tags leaked - the "funky" inconsistency.)
    const container = makeTreeItemTagPane([['D157FA', 111]]);
    document.body.appendChild(container);
    const { app } = makeApp([container]);
    const obs = new TagPaneObserver(app as never, new Plugin());
    obs.setRules([hexRule()]);
    obs.attachAll();
    await flushRaf();

    const row = container.querySelector('.tag-pane-tag') as HTMLElement;
    expect(row.classList.contains(HIDDEN_CLASS)).toBe(true);
  });

  it('leaves a non-hex word tag visible (the fix must not over-hide)', async () => {
    // "review" is not a hex code; it must stay visible. Guards against the fix
    // reading something that turns a real tag into a false hex match.
    const container = makeTreeItemTagPane([['review', 12]]);
    document.body.appendChild(container);
    const { app } = makeApp([container]);
    const obs = new TagPaneObserver(app as never, new Plugin());
    obs.setRules([hexRule()]);
    obs.attachAll();
    await flushRaf();

    const row = container.querySelector('.tag-pane-tag') as HTMLElement;
    expect(row.classList.contains(HIDDEN_CLASS)).toBe(false);
  });
});

/**
 * Coherence-sweep fixtures: a fake tag-pane VIEW carrying the two undocumented
 * internals the sweep touches (`tagDoms`, `tree.infinityScroll`). Shapes mirror
 * what live probes captured on Obsidian 1.12.7 (findings brief, Commands K/L):
 * `tagDoms` maps lowercase '#tag' keys to items whose `selfEl` IS the
 * `.tag-pane-tag` row, and the virtualizer's `measure(parent, item)` re-reads
 * the row's real geometry into `item.info`. Without the sweep, a row hidden by
 * CSS keeps `info.hidden=false` and the layout sums count it at the average
 * row height (the zombie-average gap).
 */
interface FakeSweepItem {
  selfEl: HTMLElement;
  parent?: unknown;
  info: { hidden: boolean; height: number };
}

function makeSweepHarness(
  tags: string[],
  modelHidden: Partial<Record<string, boolean>> = {},
) {
  const container = makeTagPane(tags);
  document.body.appendChild(container);

  const tagDoms: Record<string, FakeSweepItem> = {};
  const rows = Array.from(container.querySelectorAll<HTMLElement>('.tag-pane-tag'));
  rows.forEach((row, i) => {
    const tag = tags[i];
    const hidden = modelHidden[tag] ?? false;
    tagDoms[`#${tag.toLowerCase()}`] = {
      selfEl: row,
      info: { hidden, height: hidden ? 0 : 27 },
    };
  });

  const rootEl = { root: true };
  // Mimics the real measure (Command K7): re-reads the row's display state.
  const measure = vi.fn((_parent: unknown, item: FakeSweepItem) => {
    const nowHidden = item.selfEl.classList.contains(HIDDEN_CLASS);
    item.info.hidden = nowHidden;
    item.info.height = nowHidden ? 0 : 27;
  });
  const updateVirtualDisplay = vi.fn();

  const view = new View(container) as View & {
    tagDoms?: Record<string, FakeSweepItem>;
    tree?: { infinityScroll?: unknown };
  };
  view.tagDoms = tagDoms;
  view.tree = { infinityScroll: { rootEl, measure, updateVirtualDisplay } };

  const leaf = new WorkspaceLeaf(view);
  const workspace: FakeWorkspace = {
    onLayoutReady: (cb) => cb(),
    on: (event, cb) => ({ event, cb }),
    getLeavesOfType: (type) => (type === TAG_VIEW_TYPE ? [leaf] : []),
  };
  return {
    app: { workspace },
    container,
    view,
    tagDoms,
    rootEl,
    measure,
    updateVirtualDisplay,
  };
}

describe('TagPaneObserver virtualizer coherence sweep (zombie-average repair)', () => {
  it('re-measures a newly hidden row whose model still says visible, then refreshes the display once', async () => {
    const h = makeSweepHarness(['t', 'other']);
    const obs = new TagPaneObserver(h.app as never, new Plugin());
    obs.setRules([rule()]);
    obs.attachAll();
    await flushRaf();

    expect(h.measure).toHaveBeenCalledTimes(1);
    expect(h.measure).toHaveBeenCalledWith(h.rootEl, h.tagDoms['#t']);
    expect(h.tagDoms['#t'].info.hidden).toBe(true);
    expect(h.tagDoms['#other'].info.hidden).toBe(false);
    expect(h.updateVirtualDisplay).toHaveBeenCalledTimes(1);
  });

  it('re-measures upward when a row is un-hidden (rule removed)', async () => {
    const h = makeSweepHarness(['t']);
    const obs = new TagPaneObserver(h.app as never, new Plugin());
    obs.setRules([rule()]);
    obs.attachAll();
    await flushRaf();
    expect(h.tagDoms['#t'].info.hidden).toBe(true);

    obs.setRules([]);
    await flushRaf();

    expect(h.tagDoms['#t'].info.hidden).toBe(false);
    expect(h.measure).toHaveBeenCalledTimes(2);
    expect(h.updateVirtualDisplay).toHaveBeenCalledTimes(2);
  });

  it('passes the item parent to measure when the item has one', async () => {
    const h = makeSweepHarness(['t']);
    const parentItem = { parentMarker: true };
    h.tagDoms['#t'].parent = parentItem;
    const obs = new TagPaneObserver(h.app as never, new Plugin());
    obs.setRules([rule()]);
    obs.attachAll();
    await flushRaf();

    expect(h.measure).toHaveBeenCalledWith(parentItem, h.tagDoms['#t']);
  });

  it('leaves a coherent pane untouched (no measure, no display refresh)', async () => {
    const h = makeSweepHarness(['t', 'other']);
    const obs = new TagPaneObserver(h.app as never, new Plugin());
    obs.setRules([]);
    obs.attachAll();
    await flushRaf();

    expect(h.measure).not.toHaveBeenCalled();
    expect(h.updateVirtualDisplay).not.toHaveBeenCalled();
  });

  it('degrades silently when the view lacks the virtualizer internals', async () => {
    const h = makeSweepHarness(['t']);
    h.view.tree = undefined;
    const obs = new TagPaneObserver(h.app as never, new Plugin());
    obs.setRules([rule()]);
    obs.attachAll();
    await flushRaf();

    const row = h.container.querySelector('.tag-pane-tag') as HTMLElement;
    expect(row.classList.contains(HIDDEN_CLASS)).toBe(true);
    expect(h.updateVirtualDisplay).not.toHaveBeenCalled();
  });

  it('degrades silently when measure is not a function', async () => {
    const h = makeSweepHarness(['t']);
    h.view.tree = {
      infinityScroll: {
        rootEl: h.rootEl,
        measure: undefined,
        updateVirtualDisplay: h.updateVirtualDisplay,
      },
    };
    const obs = new TagPaneObserver(h.app as never, new Plugin());
    obs.setRules([rule()]);
    obs.attachAll();
    await flushRaf();

    const row = h.container.querySelector('.tag-pane-tag') as HTMLElement;
    expect(row.classList.contains(HIDDEN_CLASS)).toBe(true);
    expect(h.updateVirtualDisplay).not.toHaveBeenCalled();
  });

  it('swallows a measure that throws, repairs the rest, and retries the victim next pass', async () => {
    const h = makeSweepHarness(['t', 't2']);
    h.measure.mockImplementationOnce(() => {
      throw new Error('host hiccup');
    });
    const obs = new TagPaneObserver(h.app as never, new Plugin());
    obs.setRules([rule({ match: { type: 'list', list: ['t', 't2'] } })]);
    obs.attachAll(); // synchronous first pass: 't' repair throws, 't2' repairs

    expect(h.tagDoms['#t'].info.hidden).toBe(false); // throw victim, still stale
    expect(h.tagDoms['#t2'].info.hidden).toBe(true); // unaffected by the throw

    await flushRaf(); // the next pass finds 't' still incoherent and retries

    expect(h.tagDoms['#t'].info.hidden).toBe(true);
    expect(h.updateVirtualDisplay).toHaveBeenCalledTimes(2);
  });

  it('sweeps immediately on disable so un-hidden rows are re-measured', async () => {
    const h = makeSweepHarness(['t']);
    const obs = new TagPaneObserver(h.app as never, new Plugin());
    obs.setRules([rule()]);
    obs.attachAll();
    await flushRaf();
    expect(h.tagDoms['#t'].info.hidden).toBe(true);

    obs.setEnabled(false);

    expect(h.tagDoms['#t'].info.hidden).toBe(false);
  });

  it('sweeps during apply passes while disabled (kill-switch coherence)', async () => {
    const h = makeSweepHarness(['t']);
    const obs = new TagPaneObserver(h.app as never, new Plugin());
    obs.setRules([rule()]);
    obs.attachAll();
    await flushRaf();
    obs.setEnabled(false);

    // Damage the model behind the plugin's back; a later pass must repair it.
    h.tagDoms['#t'].info.hidden = true;
    obs.setRules([]);
    await flushRaf();

    expect(h.tagDoms['#t'].info.hidden).toBe(false);
  });

  it('sweeps on unload so the pane model is left coherent', async () => {
    const h = makeSweepHarness(['t']);
    const obs = new TagPaneObserver(h.app as never, new Plugin());
    obs.setRules([rule()]);
    obs.attachAll();
    await flushRaf();
    expect(h.tagDoms['#t'].info.hidden).toBe(true);

    obs.unload();

    expect(h.tagDoms['#t'].info.hidden).toBe(false);
  });
});
