/**
 * Virtualized, sortable, filterable, searchable tag table (Phase 3B-1, Step 2).
 *
 * Plain-DOM component (no framework). Given the headless TagListModel +
 * TagActions and a host for settings/meta access plus a refresh callback, it
 * renders:
 *   - a toolbar: search on top, an optional Filter-by-rule dropdown, a column
 *     selector, then filter chips (primary always shown; the rest behind a
 *     More/Less toggle in the narrow pane, all shown in the wide settings tab);
 *   - a WINDOWED row body: a scroll container with a spacer sized
 *     total * rowHeight, rendering only the rows in visibleRange(...) at their
 *     correct vertical offset, so 1500+ tags stay smooth;
 *   - a contextual bulk-action bar (BulkBar) shown only when a selection exists;
 *   - per-row checkboxes, a header "select all matching" affordance (operating
 *     on model.rows(), virtualization-safe), and a per-row more-actions menu.
 *
 * Columns are data-driven (ALL_COLS): which ones are present depends on the mode
 * (select + actions chrome is manage-only) and on the per-surface column prefs
 * (Last indexed / Source / Rule are user-toggleable, independent per surface). The
 * grid template is computed from the active column set and published as the
 * --tct-grid CSS variable so the header and rows stay aligned.
 *
 * The component owns DOM only; all filter / sort / search / selection /
 * visibility logic lives in the model and actions, which are already tested.
 * DOM behaviors (scroll windowing, menu, popover) are verified in the Phase 11
 * manual TESTING matrix, not unit tests (the obsidian stub lacks full DOM/Menu).
 */
import { Menu, setIcon } from 'obsidian';
import { makeActivatable } from '../../util/a11y';
import { TableColumnPrefs, TableSurface } from '../../types';
import { FilterChip, SortKey, TagListModel, TagRow } from '../tagList/tagListModel';
import { TagActions } from '../tagList/tagActions';
import { visibleRange } from './visibleRange';
import { BulkBar } from './bulkBar';
import { openRowMenu } from './rowMenu';
import { TagListDiagnosticsHost } from './tagTableHost';

const ROW_HEIGHT = 40; // px; must match .tct-row height in styles.css.
const OVERSCAN = 6;
const SEARCH_DEBOUNCE_MS = 120;

// The four most-used filters are always visible; the rest sit behind a
// More/Less toggle in the pane (item 4). Note "Shown" displays as "Visible".
const PRIMARY_CHIPS: Array<[FilterChip, string]> = [
  ['all', 'All'],
  ['shown', 'Visible'],
  ['hidden', 'Hidden'],
  ['orphans', 'Orphans'],
];
const SECONDARY_CHIPS: Array<[FilterChip, string]> = [
  ['flagged', 'Flagged'],
  ['frontmatter', 'Frontmatter'],
  ['inline', 'Inline'],
  ['unreviewed', 'Unreviewed'],
];

type ColId = 'select' | 'name' | 'count' | 'lastSeen' | 'source' | 'visible' | 'rule' | 'actions';

interface ColDef {
  id: ColId;
  track: string;
  label?: string;
  icon?: string;
  sortKey?: SortKey;
  tip?: string;
  manageOnly?: boolean;
  optional?: keyof TableColumnPrefs;
}

const ALL_COLS: ColDef[] = [
  { id: 'select', track: '34px', manageOnly: true },
  { id: 'name', track: 'minmax(150px, 2fr)', label: 'Tag', sortKey: 'name' },
  {
    id: 'count',
    track: '72px',
    label: 'Count',
    sortKey: 'count',
    tip: 'Number of notes this tag appears in.',
  },
  {
    id: 'lastSeen',
    track: '104px',
    label: 'Last indexed',
    sortKey: 'lastSeen',
    optional: 'lastSeen',
    tip: 'When an index scan last recorded this tag (not how recently you used it).',
  },
  {
    id: 'source',
    track: '78px',
    label: 'Source',
    sortKey: 'source',
    optional: 'source',
    tip: 'Where the tag is written: inline (#tag in the body), frontmatter (a YAML property), or both. Not the same as a visibility scope.',
  },
  {
    id: 'visible',
    track: '52px',
    label: 'Visible',
    icon: 'eye',
    sortKey: 'visible',
    tip: 'Green = shown. Gray = hidden by a rule. Amber = flagged (Preview mode would hide it).',
  },
  {
    id: 'rule',
    track: 'minmax(130px, 1.5fr)',
    label: 'Rule',
    optional: 'rule',
    tip: 'The effective rule or preset affecting this tag.',
  },
  { id: 'actions', track: '40px', manageOnly: true },
];

const OPTIONAL_COLS: Array<[keyof TableColumnPrefs, string]> = [
  ['lastSeen', 'Last indexed'],
  ['source', 'Source'],
  ['rule', 'Rule'],
];

const DEFAULT_COLS: TableColumnPrefs = { lastSeen: true, source: true, rule: true };

/** Optional Filter-by-rule dropdown config (the settings All tags tab passes it). */
export interface RuleFilterConfig {
  options: Array<{ id: string; name: string }>;
  current: string | null;
  onChange: (id: string | null) => void;
}

export interface TagTableOptions {
  initialMode?: 'view' | 'manage';
  /** Which independent column-prefs slot this table uses + drives its chip default. */
  surface: TableSurface;
  /** When provided, the toolbar renders a Filter-by-rule dropdown (settings only). */
  ruleFilter?: RuleFilterConfig;
}

export class TagTable {
  private root: HTMLElement;
  private chipEls = new Map<FilterChip, HTMLElement>();
  private searchInput!: HTMLInputElement;
  private headerCells = new Map<SortKey, HTMLElement>();
  private selectAllCb: HTMLInputElement | null = null;
  private chipBar!: HTMLElement;
  private headRow!: HTMLElement;
  // The collapsible secondary-chip wrap + its toggle (pane only).
  private secondaryWrap: HTMLElement | null = null;
  private moreToggle: HTMLElement | null = null;
  private secondaryCollapsed: boolean;

  private scrollEl!: HTMLElement;
  private spacerEl!: HTMLElement;
  private rowsLayer!: HTMLElement;
  private emptyEl!: HTMLElement;

  private bulkBar: BulkBar;

  private rows: TagRow[] = [];

  private cols: TableColumnPrefs = { ...DEFAULT_COLS };
  private colSig = '';

  private searchTimer: number | null = null;

  private mode: 'view' | 'manage';
  private readonly surface: TableSurface;
  private readonly ruleFilter?: RuleFilterConfig;

  private readonly onScroll = (): void => { this.renderWindow(); };

  /**
   * The viewport height the current window was rendered against; -1 until the
   * first render. DA-25: the constructor renders synchronously, before the leaf
   * has layout, so scrollEl.clientHeight is 0 and visibleRange correctly returns
   * [0, OVERSCAN) - six rows for a list of any size. The spacer is sized from the
   * row COUNT (no layout needed), so the scrollbar looked right while the pane
   * painted six rows. Nothing recomputed that window: the sole trigger was the
   * scroll listener, which made scrolling an accidental recovery rather than a
   * fix, and left dead space when the sidebar was dragged taller.
   *
   * The observer below is the recompute the table never had. It covers both
   * triggers with one mechanism: layout landing (0 -> real height) and any later
   * resize. Guarded on an actual height CHANGE so a re-render can never feed back
   * into the observer.
   */
  private lastViewportHeight = -1;
  private resizeObs: ResizeObserver | null = null;

  constructor(
    parent: HTMLElement,
    private model: TagListModel,
    private actions: TagActions,
    private host: TagListDiagnosticsHost,
    opts: TagTableOptions,
  ) {
    this.mode = opts.initialMode ?? 'manage';
    this.surface = opts.surface;
    this.ruleFilter = opts.ruleFilter;
    // Pane opens with the secondary filters collapsed; the wide settings tab
    // shows them all (item 4).
    this.secondaryCollapsed = this.surface === 'pane';
    this.root = parent.createDiv({ cls: 'tct-root' });
    this.buildToolbar();
    this.bulkBar = new BulkBar(this.root, this.model, this.actions, this.host);
    this.buildBody();
    this.root.toggleClass('tct-view', this.mode === 'view');
    this.refresh();
  }

  /** Switch between view (read-only browse) and manage (full edit) mode. */
  setMode(mode: 'view' | 'manage'): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.root.toggleClass('tct-view', mode === 'view');
    this.refresh();
  }

  // -----------------------------------------------------------------
  // Toolbar: search (top) + rule filter + columns, then chips
  // -----------------------------------------------------------------

  private buildToolbar(): void {
    const toolbar = this.root.createDiv({ cls: 'tct-toolbar' });

    // Row 1: search grows, then the optional rule filter, then the column picker.
    const topRow = toolbar.createDiv({ cls: 'tct-toolbar-top' });
    const searchWrap = topRow.createDiv({ cls: 'tct-search' });
    const searchIc = searchWrap.createSpan({ cls: 'tct-search-ic' });
    setIcon(searchIc, 'search');
    this.searchInput = searchWrap.createEl('input', {
      type: 'text',
      placeholder: 'Search tags...',
    });
    this.searchInput.addEventListener('input', () => {
      if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => {
        this.model.setSearch(this.searchInput.value);
        this.refresh();
      }, SEARCH_DEBOUNCE_MS);
    });

    if (this.ruleFilter) this.buildRuleFilter(topRow, this.ruleFilter);

    const colsBtn = topRow.createEl('button', { cls: 'tct-cols-btn', text: 'Columns' });
    colsBtn.setAttribute('aria-label', 'Choose visible columns');
    colsBtn.addEventListener('click', (evt) => this.openColumnMenu(evt));

    // Row 2: filter chips.
    this.chipBar = toolbar.createDiv({ cls: 'tct-chips' });
    this.buildChips();

    // Sticky header row above the scroll body; populated by buildHeader once the
    // active column set is known (and rebuilt when it changes).
    this.headRow = this.root.createDiv({ cls: 'tct-head-row' });
  }

  private buildRuleFilter(parent: HTMLElement, cfg: RuleFilterConfig): void {
    const wrap = parent.createDiv({ cls: 'tct-rulefilter' });
    wrap.createSpan({ cls: 'tct-rulefilter-label', text: 'Rule' });
    const sel = wrap.createEl('select', { cls: 'dropdown tct-rulefilter-select' });
    sel.createEl('option', { value: '', text: 'All tags' });
    for (const o of cfg.options) sel.createEl('option', { value: o.id, text: o.name });
    sel.value = cfg.current ?? '';
    sel.addEventListener('change', () => cfg.onChange(sel.value || null));
  }

  private buildChips(): void {
    const makeChip = (parent: HTMLElement, id: FilterChip, label: string): void => {
      const chip = parent.createDiv({ cls: 'tct-chip', text: label });
      chip.setAttribute('aria-pressed', 'false');
      this.chipEls.set(id, chip);
      makeActivatable(chip, () => {
        this.model.setFilter(id);
        this.refresh();
      });
    };

    for (const [id, label] of PRIMARY_CHIPS) makeChip(this.chipBar, id, label);

    if (this.surface === 'pane') {
      // Pane: a More/Less toggle reveals the rest, collapsed by default.
      this.moreToggle = this.chipBar.createEl('button', { cls: 'tct-chips-more' });
      this.secondaryWrap = this.chipBar.createDiv({ cls: 'tct-chips-secondary' });
      for (const [id, label] of SECONDARY_CHIPS) makeChip(this.secondaryWrap, id, label);
      this.syncMoreToggle();
      this.moreToggle.addEventListener('click', () => {
        this.secondaryCollapsed = !this.secondaryCollapsed;
        this.syncMoreToggle();
      });
    } else {
      // Settings: plenty of width, so show every chip inline.
      for (const [id, label] of SECONDARY_CHIPS) makeChip(this.chipBar, id, label);
    }
  }

  private syncMoreToggle(): void {
    if (!this.moreToggle || !this.secondaryWrap) return;
    this.secondaryWrap.toggleClass('tc-hidden', this.secondaryCollapsed);
    this.moreToggle.toggleClass('open', !this.secondaryCollapsed);
    this.moreToggle.empty();
    this.moreToggle.createSpan({ text: this.secondaryCollapsed ? 'More' : 'Less' });
    this.moreToggle.createSpan({ cls: 'tct-chips-more-caret', text: '▾' });
  }

  /** The columns present right now, given mode + per-surface prefs. */
  private activeCols(): ColDef[] {
    return ALL_COLS.filter((c) => {
      if (c.manageOnly && this.mode !== 'manage') return false;
      if (c.optional && !this.cols[c.optional]) return false;
      return true;
    });
  }

  /** Publish the grid template so the header and rows share one column layout. */
  private applyGrid(): void {
    this.root.style.setProperty(
      '--tct-grid',
      this.activeCols().map((c) => c.track).join(' '),
    );
  }

  /** (Re)build the sortable header row for the current active column set. */
  private buildHeader(): void {
    this.headRow.empty();
    this.headerCells.clear();
    this.selectAllCb = null;

    for (const col of this.activeCols()) {
      if (col.id === 'select') {
        const selCell = this.headRow.createDiv({ cls: 'tct-cell tct-cell-select' });
        const cb = selCell.createEl('input', { type: 'checkbox' });
        cb.setAttribute('aria-label', 'Select all matching tags');
        cb.addEventListener('change', () => {
          if (cb.checked) this.model.selectAllMatching();
          else this.model.deselectAllMatching();
          this.refresh();
        });
        this.selectAllCb = cb;
        continue;
      }
      if (col.id === 'actions') {
        this.headRow.createDiv({ cls: 'tct-cell tct-cell-actions' });
        continue;
      }
      const cell = this.headRow.createDiv({ cls: 'tct-cell tct-cell-' + col.id });
      if (col.tip) cell.setAttribute('title', col.tip);
      if (col.icon) {
        const ic = cell.createSpan({ cls: 'tct-head-ic' });
        ic.setAttribute('aria-label', col.label ?? col.id);
        setIcon(ic, col.icon);
      } else {
        cell.createSpan({ text: col.label ?? '' });
      }
      if (col.sortKey) {
        const sk = col.sortKey;
        cell.addClass('tct-head-sortable');
        cell.createSpan({ cls: 'tct-sort-arrow' });
        this.headerCells.set(sk, cell);
        makeActivatable(cell, () => {
          this.model.setSort(sk);
          this.refresh();
        });
      }
    }
  }

  private openColumnMenu(evt: MouseEvent): void {
    const menu = new Menu();
    for (const [key, label] of OPTIONAL_COLS) {
      menu.addItem((item) =>
        item
          .setTitle(label)
          .setChecked(this.cols[key])
          .onClick(() => {
            this.host.setColumns({ ...this.cols, [key]: !this.cols[key] });
          }),
      );
    }
    menu.showAtMouseEvent(evt);
  }

  private buildBody(): void {
    this.scrollEl = this.root.createDiv({ cls: 'tct-scroll' });
    this.spacerEl = this.scrollEl.createDiv({ cls: 'tct-spacer' });
    this.rowsLayer = this.spacerEl.createDiv({ cls: 'tct-rows' });
    this.emptyEl = this.root.createDiv({ cls: 'tct-empty' });
    this.emptyEl.addClass('tc-hidden');

    this.scrollEl.addEventListener('scroll', this.onScroll);

    // DA-25. Fires when the leaf is first laid out (clientHeight 0 -> real) and
    // on every sidebar resize thereafter.
    this.resizeObs = new ResizeObserver(() => {
      if (this.scrollEl.clientHeight === this.lastViewportHeight) return;
      this.renderWindow();
    });
    this.resizeObs.observe(this.scrollEl);
  }

  // -----------------------------------------------------------------
  // Refresh: recompute rows, update toolbar state, render the window
  // -----------------------------------------------------------------

  /** Public entry: recompute from the model and repaint. Called by the host. */
  refresh(): void {
    this.syncColumns();
    this.rows = this.model.rows();
    this.syncChips();
    this.syncSortHeaders();
    this.syncSelectAll();
    this.bulkBar.update();

    const total = this.rows.length;
    this.spacerEl.style.height = `${total * ROW_HEIGHT}px`;

    if (total === 0) {
      this.scrollEl.addClass('tc-hidden');
      this.emptyEl.removeClass('tc-hidden');
      this.emptyEl.setText(
        this.model.activeFilter === 'all' &&
          this.model.activeRuleFilter === null
          ? 'No tags yet. Start tagging notes to populate this list.'
          : 'No tags match the current filter.',
      );
      return;
    }
    this.scrollEl.removeClass('tc-hidden');
    this.emptyEl.addClass('tc-hidden');

    const maxScroll = Math.max(0, total * ROW_HEIGHT - this.scrollEl.clientHeight);
    if (this.scrollEl.scrollTop > maxScroll) {
      this.scrollEl.scrollTop = maxScroll;
    }

    this.renderWindow();
  }

  /**
   * Re-read this surface's column prefs and rebuild the header + grid only when
   * the active column set changed (mode switch or a column toggle). Normal
   * refreshes (search / sort / filter) leave the header intact.
   */
  private syncColumns(): void {
    this.cols = this.host.getColumns() ?? { ...DEFAULT_COLS };
    const sig = this.mode + ':' + this.activeCols().map((c) => c.id).join(',');
    if (sig !== this.colSig) {
      this.colSig = sig;
      this.buildHeader();
      this.applyGrid();
    }
  }

  private syncChips(): void {
    for (const [id, el] of this.chipEls) {
      const active = id === this.model.activeFilter;
      el.toggleClass('active', active);
      el.setAttribute('aria-pressed', String(active));
    }
  }

  private syncSortHeaders(): void {
    const { key, desc } = this.model.sortState;
    for (const [colKey, cell] of this.headerCells) {
      const arrow = cell.querySelector('.tct-sort-arrow') as HTMLElement | null;
      cell.toggleClass('active', colKey === key);
      if (!arrow) continue;
      if (colKey === key) arrow.setText(desc ? '▼' : '▲');
      else arrow.setText('');
    }
  }

  private syncSelectAll(): void {
    if (!this.selectAllCb) return;
    this.selectAllCb.checked = this.model.allMatchingSelected();
  }

  // -----------------------------------------------------------------
  // Virtualized window
  // -----------------------------------------------------------------

  private renderWindow(): void {
    // Record the height this window was computed for, so the resize observer can
    // tell a real layout change from a no-op callback (DA-25).
    const viewport = this.scrollEl.clientHeight;
    this.lastViewportHeight = viewport;

    const { start, end } = visibleRange(
      this.scrollEl.scrollTop,
      ROW_HEIGHT,
      viewport,
      this.rows.length,
      OVERSCAN,
    );

    this.rowsLayer.empty();
    this.rowsLayer.style.transform = `translateY(${start * ROW_HEIGHT}px)`;

    for (let i = start; i < end; i++) {
      this.renderRow(this.rows[i]);
    }
  }

  private renderRow(row: TagRow): void {
    const tr = this.rowsLayer.createDiv({ cls: 'tct-row' });
    if (row.visibility === 'hidden') tr.addClass('tct-row-hidden');
    if (row.visibility === 'flagged') tr.addClass('tct-row-flagged');
    if (row.visibility === 'marked') tr.addClass('tct-row-marked');
    for (const col of this.activeCols()) {
      this.renderCell(tr, col, row);
    }
  }

  private renderCell(tr: HTMLElement, col: ColDef, row: TagRow): void {
    switch (col.id) {
      case 'select': {
        const selCell = tr.createDiv({ cls: 'tct-cell tct-cell-select' });
        const cb = selCell.createEl('input', { type: 'checkbox' });
        cb.setAttribute('aria-label', 'Select #' + row.meta.tag);
        cb.checked = this.model.selection.has(row.meta.tag);
        cb.addEventListener('change', () => {
          this.model.toggleSelect(row.meta.tag);
          this.bulkBar.update();
          this.syncSelectAll();
        });
        break;
      }
      case 'name': {
        const nameCell = tr.createDiv({ cls: 'tct-cell tct-cell-name' });
        nameCell.createSpan({ cls: 'tct-tagname', text: '#' + row.meta.tag });
        if (row.visibility === 'marked') {
          // #3: recoloring the name alone reads as too subtle, so marked
          // (flag-rule) rows also carry a small flag glyph next to the name.
          const flag = nameCell.createSpan({ cls: 'tct-flag-mark' });
          flag.setAttribute('aria-label', 'Flagged');
          flag.setAttribute('title', 'Flagged');
          setIcon(flag, 'flag');
        }
        if (row.meta.reviewed) {
          const mark = nameCell.createSpan({ cls: 'tct-reviewed-mark' });
          mark.setAttribute('aria-label', 'Reviewed');
          mark.setAttribute('title', 'Reviewed');
          setIcon(mark, 'check');
        }
        if (this.mode === 'view') {
          nameCell.addClass('tct-tagname-link');
          makeActivatable(nameCell, () => this.host.searchTag(row.meta.tag));
        }
        break;
      }
      case 'count':
        tr.createDiv({ cls: 'tct-cell tct-cell-count', text: String(row.meta.count) });
        break;
      case 'lastSeen':
        tr.createDiv({
          cls: 'tct-cell tct-cell-lastSeen',
          text: this.formatDate(row.meta.lastSeen),
        });
        break;
      case 'source': {
        const srcCell = tr.createDiv({ cls: 'tct-cell tct-cell-source' });
        srcCell.createSpan({
          cls: 'tct-src',
          text: row.meta.sources.length === 2 ? 'both' : (row.meta.sources[0] ?? '?'),
        });
        break;
      }
      case 'visible': {
        const visCell = tr.createDiv({ cls: 'tct-cell tct-cell-visible' });
        const dot = visCell.createSpan({ cls: 'tct-vis-dot tct-vis-' + row.visibility });
        dot.setAttribute('aria-label', row.visibility);
        dot.setAttribute('title', row.visibility);
        break;
      }
      case 'rule': {
        const ruleCell = tr.createDiv({ cls: 'tct-cell tct-cell-rule' });
        const eff = row.matches[0];
        if (eff) {
          // A subtle pill reads more intentionally than truncated link text and
          // carries the full name on hover (item 10).
          const pill = ruleCell.createSpan({ cls: 'tct-rule-pill', text: eff.ruleName });
          pill.setAttribute('title', eff.ruleName);
        } else {
          ruleCell.createSpan({ cls: 'tct-rule-none', text: 'none' });
        }
        break;
      }
      case 'actions': {
        const actCell = tr.createDiv({ cls: 'tct-cell tct-cell-actions' });
        // A literal vertical-ellipsis glyph instead of setIcon: the Lucide
        // "more-vertical" name did not render in some Obsidian builds, leaving an
        // empty button (item 7). A Unicode glyph is build-independent.
        const moreBtn = actCell.createEl('button', { cls: 'tct-more-btn', text: '⋮' });
        moreBtn.setAttribute('aria-label', 'Tag actions');
        moreBtn.addEventListener('click', (evt) => {
          openRowMenu(evt, row.meta.tag, this.actions, this.host);
        });
        break;
      }
    }
  }

  private formatDate(ts: number): string {
    if (!ts) return '-';
    return new Date(ts).toLocaleDateString();
  }

  // -----------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------

  destroy(): void {
    if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
    this.scrollEl.removeEventListener('scroll', this.onScroll);
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    this.bulkBar.destroy();
    this.root.remove();
  }
}
