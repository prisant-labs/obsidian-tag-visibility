// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Plugin, WorkspaceLeaf } from 'obsidian';
import { PropertiesObserver } from '../src/observers/propertiesObserver';
import { Rule, TagMeta } from '../src/types';

// plugin-namespaced decoration classes / marker for the Properties scope.
// Distinct from tag-pane (tag-curator-*) and NN (tc-nn-*) namespaces.
const HIDDEN_CLASS = 'tc-prop-hidden';
const FLAG_CLASS = 'tc-prop-flagged';
const RULE_ATTR = 'data-tc-prop-rule';

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'r',
    name: 'r',
    enabled: true,
    priority: 50,
    match: { type: 'list', list: ['draft'] },
    action: 'hide',    ...overrides,
  };
}

function meta(tag: string, count: number): TagMeta {
  return {
    tag,
    firstSeen: 0,
    lastSeen: 0,
    count,
    sources: ['frontmatter'],
  };
}

/**
 * One tag pill as the Properties metadata editor renders a multi-select value:
 * div.multi-select-pill with the tag text in .multi-select-pill-content.
 * Properties strips the leading '#'; the pill text is the bare tag.
 */
function makeTagPill(tag: string): HTMLElement {
  const pill = document.createElement('div');
  pill.className = 'multi-select-pill';
  const content = document.createElement('span');
  content.className = 'multi-select-pill-content';
  content.textContent = tag;
  pill.appendChild(content);
  return pill;
}

/**
 * A property row: div.metadata-property[data-property-key=KEY] holding a
 * .metadata-property-value wrapper with its pills inside. Mirrors the runtime
 * Properties editor shape (version-fragile DOM contract).
 */
function makePropertyRow(key: string, tags: string[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'metadata-property';
  row.setAttribute('data-property-key', key);
  const value = document.createElement('div');
  value.className = 'metadata-property-value';
  for (const t of tags) value.appendChild(makeTagPill(t));
  row.appendChild(value);
  return row;
}

/**
 * The Properties metadata container the observer watches. Holds a tags property
 * row plus, optionally, a non-tags property row (e.g. author) whose pills must
 * NEVER be touched.
 */
function makePropertiesContainer(
  rows: Array<{ key: string; tags: string[] }>,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'metadata-container';
  const properties = document.createElement('div');
  properties.className = 'metadata-properties';
  for (const { key, tags } of rows) {
    properties.appendChild(makePropertyRow(key, tags));
  }
  container.appendChild(properties);
  return container;
}

interface FakeWorkspace {
  onLayoutReady: (cb: () => void) => void;
  on: (event: string, cb: () => void) => { event: string; cb: () => void };
  getLeavesOfType: (type: string) => WorkspaceLeaf[];
}

/**
 * The Properties editor lives inside a markdown file view (and a dedicated
 * 'file-properties' leaf). The observer discovers containers by querying the
 * document for .metadata-container, so the fake workspace only needs to drive
 * onLayoutReady / layout-change and return no leaves.
 */
function makeApp(): { app: { workspace: FakeWorkspace } } {
  const workspace: FakeWorkspace = {
    onLayoutReady: (cb) => cb(),
    on: (event, cb) => ({ event, cb }),
    getLeavesOfType: () => [],
  };
  return { app: { workspace } };
}

function flushRaf(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function pillFor(container: HTMLElement, tag: string): HTMLElement {
  const pills = Array.from(
    container.querySelectorAll<HTMLElement>('.multi-select-pill'),
  );
  return pills.find(
    (p) => (p.querySelector('.multi-select-pill-content')?.textContent ?? '').trim() === tag,
  ) as HTMLElement;
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

describe('PropertiesObserver basic decoration', () => {
  it('hides a tag pill in the tags row that matches a hide rule, and not the others', async () => {
    const container = makePropertiesContainer([
      { key: 'tags', tags: ['draft', 'keep'] },
    ]);
    document.body.appendChild(container);
    const obs = new PropertiesObserver(makeApp().app as never, new Plugin());
    obs.setRules([rule()]);
    obs.attachAll();
    await flushRaf();

    expect(pillFor(container, 'draft').classList.contains(HIDDEN_CLASS)).toBe(true);
    expect(pillFor(container, 'keep').classList.contains(HIDDEN_CLASS)).toBe(false);
  });

  it('sets the data-tc-prop-rule marker and aria-hidden on hidden pills', async () => {
    const container = makePropertiesContainer([{ key: 'tags', tags: ['draft'] }]);
    document.body.appendChild(container);
    const obs = new PropertiesObserver(makeApp().app as never, new Plugin());
    obs.setRules([rule({ id: 'hide-draft' })]);
    obs.attachAll();
    await flushRaf();

    const pill = pillFor(container, 'draft');
    expect(pill.getAttribute(RULE_ATTR)).toBe('hide-draft');
    expect(pill.getAttribute('aria-hidden')).toBe('true');
  });

  it('strips a leading hash (case-preserved) when matching pill text', async () => {
    // Pill text '#draft' -> base apply() strips '#' -> 'draft'. Rule list ['draft']
    // matches because the case is the same. This tests the hash-strip path only;
    // casing is unchanged so the match is valid.
    const container = makePropertiesContainer([{ key: 'tags', tags: ['#draft'] }]);
    document.body.appendChild(container);
    const obs = new PropertiesObserver(makeApp().app as never, new Plugin());
    obs.setRules([rule()]); // list ['draft']
    obs.attachAll();
    await flushRaf();

    expect(pillFor(container, '#draft').classList.contains(HIDDEN_CLASS)).toBe(true);
  });

  it('feeds tag metadata to frequency rules', async () => {
    const container = makePropertiesContainer([{ key: 'tags', tags: ['orphan'] }]);
    document.body.appendChild(container);
    const obs = new PropertiesObserver(makeApp().app as never, new Plugin());
    obs.setRules([
      rule({ id: 'orphan-rule', match: { type: 'frequency', operator: '<=', value: 1 } }),
    ]);
    obs.setMetadata(new Map([['orphan', meta('orphan', 1)]]));
    obs.attachAll();
    await flushRaf();

    expect(pillFor(container, 'orphan').classList.contains(HIDDEN_CLASS)).toBe(true);
  });
});

describe('PropertiesObserver case-sensitivity contract', () => {
  it('decorates a pill when its case matches the rule list exactly', async () => {
    // 'AI' in pill, rule list ['AI'] - case matches, pill must be hidden.
    const container = makePropertiesContainer([{ key: 'tags', tags: ['AI'] }]);
    document.body.appendChild(container);
    const obs = new PropertiesObserver(makeApp().app as never, new Plugin());
    obs.setRules([rule({ match: { type: 'list', list: ['AI'] } })]);
    obs.attachAll();
    await flushRaf();

    expect(pillFor(container, 'AI').classList.contains(HIDDEN_CLASS)).toBe(true);
  });

  it('does NOT decorate a pill when its case differs from the rule list', async () => {
    // 'AI' in pill, rule list ['ai'] - wrong case, engine is case-sensitive, no match.
    const container = makePropertiesContainer([{ key: 'tags', tags: ['AI'] }]);
    document.body.appendChild(container);
    const obs = new PropertiesObserver(makeApp().app as never, new Plugin());
    obs.setRules([rule({ match: { type: 'list', list: ['ai'] } })]);
    obs.attachAll();
    await flushRaf();

    expect(pillFor(container, 'AI').classList.contains(HIDDEN_CLASS)).toBe(false);
    expect(pillFor(container, 'AI').hasAttribute(RULE_ATTR)).toBe(false);
  });
});

describe('PropertiesObserver override across surfaces', () => {
  it('always-show override prevents hiding even when a hide rule matches', async () => {
    // Rule hides 'AI', but override says always show - pill must remain undecorated.
    const container = makePropertiesContainer([{ key: 'tags', tags: ['AI'] }]);
    document.body.appendChild(container);
    const obs = new PropertiesObserver(makeApp().app as never, new Plugin());
    obs.setRules([rule({ match: { type: 'list', list: ['AI'] } })]);
    obs.setOverrides({ AI: 'show' });
    obs.attachAll();
    await flushRaf();

    const pill = pillFor(container, 'AI');
    expect(pill.classList.contains(HIDDEN_CLASS)).toBe(false);
    expect(pill.classList.contains(FLAG_CLASS)).toBe(false);
    expect(pill.hasAttribute(RULE_ATTR)).toBe(false);
  });
});

describe('PropertiesObserver scopes to the tags property only', () => {
  it('never decorates pills in a non-tags property (e.g. author)', async () => {
    const container = makePropertiesContainer([
      { key: 'tags', tags: ['draft'] },
      // An author property whose value happens to equal a hidden tag name must
      // not be touched - the observer only reads the tags row.
      { key: 'author', tags: ['draft'] },
    ]);
    document.body.appendChild(container);
    const obs = new PropertiesObserver(makeApp().app as never, new Plugin());
    obs.setRules([rule()]);
    obs.attachAll();
    await flushRaf();

    const authorRow = container.querySelector<HTMLElement>(
      '.metadata-property[data-property-key="author"]',
    ) as HTMLElement;
    const authorPill = authorRow.querySelector<HTMLElement>('.multi-select-pill') as HTMLElement;
    expect(authorPill.classList.contains(HIDDEN_CLASS)).toBe(false);
    expect(authorPill.hasAttribute(RULE_ATTR)).toBe(false);

    // The tags-row pill of the same name IS hidden, proving the rule fired but
    // was correctly scoped.
    const tagsRow = container.querySelector<HTMLElement>(
      '.metadata-property[data-property-key="tags"]',
    ) as HTMLElement;
    const tagsPill = tagsRow.querySelector<HTMLElement>('.multi-select-pill') as HTMLElement;
    expect(tagsPill.classList.contains(HIDDEN_CLASS)).toBe(true);
  });
});

describe('PropertiesObserver idempotency', () => {
  it('re-running apply does not double-decorate', async () => {
    const container = makePropertiesContainer([{ key: 'tags', tags: ['draft'] }]);
    document.body.appendChild(container);
    const obs = new PropertiesObserver(makeApp().app as never, new Plugin());
    obs.setRules([rule()]);
    obs.attachAll();
    await flushRaf();
    obs.setRules([rule()]);
    await flushRaf();

    expect(container.querySelectorAll(`.${HIDDEN_CLASS}`).length).toBe(1);
  });

  it('attaching twice does not double-observe (one cleanup)', async () => {
    const container = makePropertiesContainer([{ key: 'tags', tags: ['draft'] }]);
    document.body.appendChild(container);
    const plugin = new Plugin();
    const obs = new PropertiesObserver(makeApp().app as never, plugin);
    obs.setRules([rule()]);
    obs.attachAll();
    obs.attachAll();
    await flushRaf();

    expect(plugin.registeredCleanups.length).toBe(1);
  });
});

describe('PropertiesObserver preview mode', () => {
  it('flags instead of hides when previewMode is on', async () => {
    const container = makePropertiesContainer([{ key: 'tags', tags: ['draft'] }]);
    document.body.appendChild(container);
    const obs = new PropertiesObserver(makeApp().app as never, new Plugin());
    obs.setRules([rule()]);
    obs.setPreviewMode(true);
    obs.attachAll();
    await flushRaf();

    const pill = pillFor(container, 'draft');
    expect(pill.classList.contains(FLAG_CLASS)).toBe(true);
    expect(pill.classList.contains(HIDDEN_CLASS)).toBe(false);
    expect(pill.hasAttribute('aria-hidden')).toBe(false);
    expect(pill.getAttribute(RULE_ATTR)).toBe('r');
  });
});

describe('PropertiesObserver defensive selectors', () => {
  it('finds no rows (and never throws) when the metadata container is absent', async () => {
    // A document with no Properties editor at all.
    const obs = new PropertiesObserver(makeApp().app as never, new Plugin());
    obs.setRules([rule()]);
    expect(() => obs.attachAll()).not.toThrow();
    await flushRaf();
    // Nothing decorated anywhere.
    expect(document.querySelectorAll(`.${HIDDEN_CLASS}`).length).toBe(0);
  });
});

describe('PropertiesObserver clear-on-unload / setEnabled', () => {
  it('setEnabled(false) strips all tc-prop-* decoration', async () => {
    const container = makePropertiesContainer([{ key: 'tags', tags: ['draft'] }]);
    document.body.appendChild(container);
    const obs = new PropertiesObserver(makeApp().app as never, new Plugin());
    obs.setRules([rule()]);
    obs.attachAll();
    await flushRaf();

    obs.setEnabled(false);

    const pill = pillFor(container, 'draft');
    expect(pill.classList.contains(HIDDEN_CLASS)).toBe(false);
    expect(pill.hasAttribute('aria-hidden')).toBe(false);
    expect(pill.hasAttribute(RULE_ATTR)).toBe(false);
  });

  it('unload removes every tc-prop-* class and marker', async () => {
    const container = makePropertiesContainer([
      { key: 'tags', tags: ['draft', 'keep'] },
    ]);
    document.body.appendChild(container);
    const obs = new PropertiesObserver(makeApp().app as never, new Plugin());
    obs.setRules([rule()]);
    obs.attachAll();
    await flushRaf();

    obs.unload();

    const pill = pillFor(container, 'draft');
    expect(pill.classList.contains(HIDDEN_CLASS)).toBe(false);
    expect(pill.classList.contains(FLAG_CLASS)).toBe(false);
    expect(pill.hasAttribute(RULE_ATTR)).toBe(false);
    // The base multi-select-pill class is untouched.
    expect(pill.classList.contains('multi-select-pill')).toBe(true);
  });
});
