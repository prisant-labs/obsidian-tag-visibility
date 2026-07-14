// @vitest-environment happy-dom
/**
 * Regression tests for DA-25: the virtualized tag table rendered only OVERSCAN
 * rows when its scroll container had no layout yet, and never recovered.
 *
 * The bug: TagTable's constructor calls refresh() -> renderWindow() synchronously,
 * before the pane leaf has been laid out, so scrollEl.clientHeight is 0.
 * visibleRange() then correctly computes ceil(0 / ROW_HEIGHT) = 0 visible rows,
 * and returns [0, OVERSCAN) - exactly 6 rows. The spacer is sized from
 * total * ROW_HEIGHT (which needs no layout), so the scrollbar looked right for a
 * 2000-row list while only 6 rows were painted. Nothing recomputed the window,
 * because the only trigger was the 'scroll' listener: scrolling was an accidental
 * recovery path, not a fix. Dragging the sidebar taller left dead space for the
 * same reason.
 *
 * This is the same shape as B-01 / B-05 / B-06: read a source that is merely
 * UNAVAILABLE (an unmeasured container) as AUTHORITATIVELY EMPTY (a zero-height
 * viewport).
 *
 * Note happy-dom performs no layout, so clientHeight is ALWAYS 0 here and its
 * ResizeObserver never fires on its own. Both are driven explicitly below, which
 * is the only way a tier-1 test can reach this bug at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './_stubs/obsidianDom'; // side effect: Obsidian's createDiv/empty/addClass on happy-dom
import { TagTable } from '../src/ui/curationWorkspace/tagTable';
import { TagListModel, TagListDataSource } from '../src/ui/tagList/tagListModel';
import { TagActions, TagActionsHost } from '../src/ui/tagList/tagActions';
import { TagListDiagnosticsHost } from '../src/ui/curationWorkspace/tagTableHost';
import {
  DEFAULT_SETTINGS,
  Rule,
  TableColumnPrefs,
  TagCuratorSettings,
  TagMeta,
} from '../src/types';

const ROW_HEIGHT = 40; // mirrors tagTable.ts
const OVERSCAN = 6; // mirrors tagTable.ts

// --- viewport height: only the scroll container reports one -----------------
let viewportHeight = 0;

// --- ResizeObserver: capture the callbacks so the test can fire them ---------
let roCallbacks: ResizeObserverCallback[] = [];
let disconnectCount = 0;

class FakeResizeObserver {
  constructor(cb: ResizeObserverCallback) {
    roCallbacks.push(cb);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    disconnectCount += 1;
  }
}

/** Simulate layout landing, or the user dragging the sidebar taller. */
function fireResize(): void {
  for (const cb of roCallbacks) {
    cb([], {} as ResizeObserver);
  }
}

function meta(tag: string, count: number): TagMeta {
  return { tag, firstSeen: 0, lastSeen: 0, count, sources: ['inline'] };
}

function source(metas: TagMeta[], rules: Rule[] = []): TagListDataSource {
  const map = new Map(metas.map((m) => [m.tag, m]));
  const s: TagCuratorSettings = {
    ...DEFAULT_SETTINGS,
    enabledPresets: [],
    customRules: rules,
  };
  return { getSettings: () => s, getMeta: () => map };
}

function actionsHost(): TagActionsHost {
  return {
    isPluginEnabled: () => false,
    getPluginInstance: () => null,
    setOverride: () => {},
    setReviewedBulk: () => {},
  };
}

function diagnosticsHost(): TagListDiagnosticsHost {
  const cols: TableColumnPrefs = { lastIndexed: true, source: true, rule: true };
  return {
    getSettings: () => ({ ...DEFAULT_SETTINGS, enabledPresets: [] }),
    getMeta: () => new Map(),
    getActiveRules: () => [],
    isPluginEnabled: () => false,
    requestRefresh: () => {},
    searchTag: () => {},
    getColumns: () => cols,
    setColumns: () => {},
  };
}

function buildTable(total: number): { table: TagTable; parent: HTMLElement } {
  const metas = Array.from({ length: total }, (_, i) =>
    meta('tag' + String(i).padStart(4, '0'), total - i),
  );
  const model = new TagListModel(source(metas));
  const table = new TagTable(
    document.body.createDiv(),
    model,
    new TagActions(actionsHost()),
    diagnosticsHost(),
    { surface: 'pane', initialMode: 'manage' },
  );
  return { table, parent: document.body };
}

function rowCount(): number {
  return document.body.querySelectorAll('.tct-row').length;
}

beforeEach(() => {
  viewportHeight = 0;
  roCallbacks = [];
  disconnectCount = 0;
  document.body.empty();

  // happy-dom returns 0 for every clientHeight. Report a height only for the
  // scroll container, so the test controls exactly the value the bug turns on.
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement): number {
      return this.classList.contains('tct-scroll') ? viewportHeight : 0;
    },
  });

  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TagTable virtualization (DA-25: unmeasured container read as an empty viewport)', () => {
  it('paints only OVERSCAN rows when constructed before the pane is laid out', () => {
    buildTable(200);
    // The pre-fix behavior, stated exactly: 0 visible + OVERSCAN = 6 rows, for a
    // 200-row list. This is not a malfunction of visibleRange; it is what a
    // zero-height viewport arithmetically means.
    expect(rowCount()).toBe(OVERSCAN);
  });

  it('sizes the spacer for the FULL list even while under-rendering', () => {
    buildTable(200);
    const spacer = document.body.querySelector('.tct-spacer') as HTMLElement;
    // This is why the bug looked like "the list failed to draw" rather than
    // "the list is short": the scrollbar was always correct.
    expect(spacer.style.height).toBe(`${200 * ROW_HEIGHT}px`);
  });

  it('fills the window once the container reports a real height', () => {
    buildTable(200);
    expect(rowCount()).toBe(OVERSCAN);

    // Layout lands: the leaf is measured for the first time.
    viewportHeight = 800;
    fireResize();

    // ceil(800 / 40) = 20 visible, + OVERSCAN = 26.
    expect(rowCount()).toBe(20 + OVERSCAN);
  });

  it('re-fills when the user drags the sidebar taller (the resize half of DA-25)', () => {
    viewportHeight = 400;
    buildTable(200);
    fireResize();
    expect(rowCount()).toBe(10 + OVERSCAN);

    viewportHeight = 800; // drag the divider down
    fireResize();
    expect(rowCount()).toBe(20 + OVERSCAN);
  });

  it('does not re-render when a resize reports the same height (no render loop)', () => {
    viewportHeight = 800;
    buildTable(200);
    fireResize();
    const first = document.body.querySelector('.tct-row');

    fireResize(); // same height: must be a no-op, not a rebuild
    expect(document.body.querySelector('.tct-row')).toBe(first);
  });

  it('disconnects the observer on destroy (no leaked observer per H10)', () => {
    const { table } = buildTable(200);
    table.destroy();
    expect(disconnectCount).toBe(1);
  });
});
