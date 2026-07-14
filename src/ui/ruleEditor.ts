/**
 * Rule editor (D-010 - card view + right-docked preview, supersedes D-001).
 *
 * Two modes share one surface (no wizard, per D-002 closed):
 *   - "cards": each rule rendered as a full-width row with toggle + name +
 *     Type pill + match summary + "N tags affected" + chevron. A dashed
 *     "+ New rule" card opens edit mode with defaults.
 *   - "edit": replaces the cards with a sectioned editor (Type / Identity /
 *     Match / Then), header with the rule name as a proper h2 + enable
 *     toggle + back-to-cards crumb.
 *
 * A right-docked preview panel stays visible across both modes:
 *   - cards mode: shows every tag any rule is currently affecting
 *   - edit mode: filtered to the selected rule, with a stats row
 *     (Unique tags / Total instances)
 *
 * Priority is hidden from the UI (D-009). New custom rules default to 50.
 */
import { App, Modal, Notice } from 'obsidian';
import TagCuratorPlugin from '../main';
import {
  Action,
  MatchCriteria,
  MatchType,
  Rule,
  TagMeta,
} from '../types';
import { RuleEngine } from '../engine/ruleEngine';
import { resolveActiveRules } from '../engine/presets';
import { compileSafeRegex } from '../util/safeRegex';
import { makeActivatable, setSwitchState } from '../util/a11y';

type Mode = 'cards' | 'edit';

const DEFAULT_PRIORITY = 50; // D-009: hidden in UI; engine uses this default.

export class RuleEditor {
  private root: HTMLElement;
  private mainEl!: HTMLElement;
  private previewEl!: HTMLElement;
  private mode: Mode = 'cards';
  private draft: Rule | null = null;
  private isNew = false;

  // Tags whose preview detail accordion is expanded. Tracked on the instance so
  // an override toggle (which re-renders the whole editor via settings.onChange)
  // keeps the open panel open instead of collapsing it.
  private openPreviewTags = new Set<string>();

  // Quick-search + column-sort state for the preview list (4-3). Held on the
  // instance so they survive the frequent re-renders (settings change, every
  // keystroke while editing a rule). previewItems + the empty message are set by
  // whichever preview builder ran; renderPreviewRows() reads them so search/sort
  // repaints only the rows, never rebuilding (and unfocusing) the search box.
  private previewSearch = '';
  private previewSort: 'name' | 'count' = 'count';
  private previewSortDesc = true;
  private previewItems: Array<{ m: TagMeta; ruleLabel: string | null }> = [];
  private previewEmptyMsg = '';
  private previewBodyEl: HTMLElement | null = null;

  // Unsubscribe handle from settingsManager.onChange; released in destroy() so
  // a mounted-then-unmounted editor (e.g. switching workspace modes) does not
  // leak a listener that keeps rendering into a detached root.
  private unsubscribeSettings: (() => void) | null = null;

  constructor(container: HTMLElement, private plugin: TagCuratorPlugin) {
    this.root = container.createDiv({ cls: 'tcr-workspace' });
    this.mainEl = this.root.createDiv({ cls: 'tcr-main' });
    this.previewEl = this.root.createDiv({ cls: 'tcr-preview-dock' });
    this.render();
    this.unsubscribeSettings = this.plugin.settingsManager.onChange(() =>
      this.render(),
    );
  }

  destroy(): void {
    this.unsubscribeSettings?.();
    this.unsubscribeSettings = null;
    this.root.remove();
  }

  // -----------------------------------------------------------------
  // Top-level render
  // -----------------------------------------------------------------

  private render(): void {
    this.mainEl.empty();
    this.previewEl.empty();
    if (this.mode === 'cards') {
      this.renderCards();
      this.renderPreviewVaultWide();
    } else {
      this.renderEdit();
      this.renderPreviewForRule(this.draft);
    }
  }

  // -----------------------------------------------------------------
  // Card view
  // -----------------------------------------------------------------

  private renderCards(): void {
    const s = this.plugin.settingsManager.get();
    const rules = s.customRules;

    const toolbar = this.mainEl.createDiv({ cls: 'tcr-toolbar' });
    toolbar.createDiv({
      cls: 'tcr-toolbar-title',
      text: `Custom rules · ${rules.length}`,
    });
    const newBtn = toolbar.createEl('button', {
      cls: 'tcr-btn tcr-btn-accent tcr-new-btn',
      text: '+ New rule',
    });
    newBtn.addEventListener('click', () => this.openEdit(null));

    const cards = this.mainEl.createDiv({ cls: 'tcr-cards' });
    for (const rule of rules) {
      this.renderCard(cards, rule);
    }
    if (rules.length === 0) this.renderNewCard(cards);
  }

  private renderCard(parent: HTMLElement, rule: Rule): void {
    const card = parent.createDiv({ cls: 'tcr-card' });
    if (!rule.enabled) card.addClass('tcr-card-off');

    const toggleWrap = card.createDiv({ cls: 'tcr-card-toggle' });
    this.makeToggle(
      toggleWrap,
      rule.enabled,
      async (next) => {
        await this.plugin.settingsManager.updateCustomRule(rule.id, {
          enabled: next,
        });
      },
      `Enable rule: ${rule.name}`,
    );

    const info = card.createDiv({ cls: 'tcr-card-info' });
    const nameEl = info.createDiv({ cls: 'tcr-card-name', text: rule.name });
    const sub = info.createDiv({ cls: 'tcr-card-sub' });
    sub.createSpan({ cls: 'tcr-card-type', text: rule.match.type });
    sub.appendText(' · ' + matchSummaryString(rule.match));

    const affectedCount = this.countAffectedForRule(rule);
    const affectedEl = card.createDiv({
      cls: 'tcr-card-affected',
      text: rule.enabled ? `${affectedCount} tags ›` : 'off',
    });
    if (!rule.enabled) affectedEl.addClass('tcr-card-affected-zero');

    // The card is a mouse convenience target (click anywhere but the toggle to
    // edit); the keyboard-focusable control is the rule-name button, a sibling
    // of the toggle, so there are no nested interactive controls.
    card.addEventListener('click', (e) => {
      const tgt = e.target as HTMLElement;
      if (tgt.closest('.tcr-card-toggle')) return;
      this.openEdit(rule);
    });
    makeActivatable(
      nameEl,
      (e) => {
        e.stopPropagation();
        this.openEdit(rule);
      },
      { role: 'button' },
    );
  }

  private renderNewCard(parent: HTMLElement): void {
    const card = parent.createDiv({ cls: 'tcr-card tcr-card-new' });
    card.createDiv({ cls: 'tcr-card-new-title', text: '+ New rule' });
    card.createDiv({
      cls: 'tcr-card-new-sub',
      text: 'Opens the editor with defaults. No separate wizard.',
    });
    makeActivatable(card, () => this.openEdit(null));
  }

  private openEdit(rule: Rule | null): void {
    if (rule) {
      this.draft = { ...rule, match: { ...rule.match } };
      this.isNew = false;
    } else {
      this.draft = this.makeDefaultRule();
      this.isNew = true;
    }
    this.mode = 'edit';
    this.render();
  }

  private makeDefaultRule(): Rule {
    return {
      id: `r-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 7)}`,
      name: 'Untitled rule',
      enabled: true,
      priority: DEFAULT_PRIORITY,
      match: { type: 'regex', pattern: '' },
      action: 'hide',
    };
  }

  // -----------------------------------------------------------------
  // Edit mode
  // -----------------------------------------------------------------

  private renderEdit(): void {
    const draft = this.draft;
    if (!draft) {
      this.exitEdit();
      return;
    }
    const edit = this.mainEl.createDiv({ cls: 'tcr-edit' });

    const head = edit.createDiv({ cls: 'tcr-edit-head' });
    // Just the back affordance: the "/ Custom rules / Edit rule" trail was noise
    // next to the rule's own title row below it (4-4).
    const crumbs = head.createDiv({ cls: 'tcr-edit-crumbs' });
    const back = crumbs.createEl('button', {
      cls: 'tcr-edit-back',
      text: '← Back to rules',
    });
    back.addEventListener('click', () => this.exitEdit());

    const title = head.createDiv({ cls: 'tcr-edit-title-row' });
    this.makeToggle(
      title,
      draft.enabled,
      (next) => {
        draft.enabled = next;
      },
      'Enable this rule',
    );
    const nameInput = title.createEl('input', { cls: 'tcr-edit-title-input' });
    nameInput.value = draft.name;
    nameInput.placeholder = 'Untitled rule';
    nameInput.addEventListener('input', () => {
      draft.name = nameInput.value;
    });

    this.section(edit, 'Type', (sec) => {
      // A single dropdown + one-line byline (2b): the three full cards crowded
      // the section and pushed the Match row down. The byline shows the selected
      // type's help text; switching type re-renders so the Match inputs follow.
      const types: Array<[MatchType, string, string]> = [
        ['regex', 'Pattern match', 'A regex against the tag name'],
        ['frequency', 'Count threshold', "Compare the tag's note-count"],
        ['list', 'Specific tags', 'An explicit list of tags'],
      ];
      const sel = sec.createEl('select', { cls: 'tcr-select tight' });
      sel.setAttribute('aria-label', 'Match type');
      for (const [t, cardTitle] of types) {
        const opt = sel.createEl('option', { value: t, text: cardTitle });
        if (draft.match.type === t) opt.selected = true;
      }
      const desc = types.find(([t]) => t === draft.match.type)?.[2] ?? '';
      sec.createDiv({ cls: 'tcr-type-byline', text: desc });
      sel.addEventListener('change', () => {
        const t = sel.value as MatchType;
        if (t === draft.match.type) return;
        draft.match = blankCriteriaFor(t);
        this.render();
      });
    });

    this.section(edit, 'Match', (sec) => {
      this.renderMatchSection(sec, draft);
    });

    this.section(edit, 'Then', (sec) => {
      const actionRow = this.row(sec);
      this.label(actionRow, 'Action');
      const ctl = this.control(actionRow);
      const sel = ctl.createEl('select', { cls: 'tcr-select tight' });
      // 1.0 ships hide + flag. show-only (used internally by the always-show
      // override) and group are deferred, so they are not offered here. A stored
      // rule carrying a deferred action still loads and resolves - it degrades to
      // the hide branch (see RuleEngine.resolveDecoration); the dropdown just
      // shows no selected option for it until the user picks hide or flag.
      for (const a of ['hide', 'flag'] as Action[]) {
        const opt = sel.createEl('option', { value: a, text: a });
        if (draft.action === a) opt.selected = true;
      }
      sel.addEventListener('change', () => {
        draft.action = sel.value as Action;
      });
    });

    const foot = edit.createDiv({ cls: 'tcr-edit-foot' });
    if (!this.isNew) {
      const del = foot.createEl('button', {
        cls: 'tcr-btn tcr-btn-warning',
        text: 'Delete rule',
      });
      del.addEventListener('click', () => void this.deleteDraft());
    }
    const cancel = foot.createEl('button', {
      cls: 'tcr-btn tcr-btn-ghost',
      text: 'Cancel',
    });
    cancel.addEventListener('click', () => this.exitEdit());
    const save = foot.createEl('button', {
      cls: 'tcr-btn tcr-btn-accent',
      text: 'Save',
    });
    save.addEventListener('click', () => void this.saveDraft());
  }

  private renderMatchSection(sec: HTMLElement, draft: Rule): void {
    const wrap = sec.createDiv({ cls: 'tcr-match-sentence' });
    wrap.createSpan({ cls: 'tcr-match-lead', text: "When a tag's name" });

    switch (draft.match.type) {
      case 'regex': {
        wrap.createSpan({
          cls: 'tcr-match-lead',
          text: ' matches the regex ',
        });
        const input = wrap.createEl('input', { cls: 'tcr-input wide' });
        input.value = draft.match.pattern ?? '';
        input.placeholder = '^draft(-|$)';
        const status = wrap.createSpan({ cls: 'tcr-regex-status' });
        const update = (): void => {
          status.empty();
          if (!input.value) return;
          try {
            compileSafeRegex(input.value);
            status.removeClass('tcr-regex-err');
            status.addClass('tcr-regex-ok');
            status.setText(' ✓ valid');
          } catch (e) {
            status.removeClass('tcr-regex-ok');
            status.addClass('tcr-regex-err');
            status.setText(' ✗ ' + (e as Error).message);
          }
        };
        input.addEventListener('input', () => {
          draft.match = { ...draft.match, pattern: input.value };
          update();
          this.renderPreviewForRule(draft);
        });
        update();
        break;
      }
      case 'frequency': {
        wrap.createSpan({
          cls: 'tcr-match-lead',
          text: ' has a count that ',
        });
        const opSel = wrap.createEl('select', { cls: 'tcr-select inline' });
        for (const op of ['<', '<=', '=', '>=', '>']) {
          const opt = opSel.createEl('option', { value: op, text: op });
          if ((draft.match.operator ?? '<=') === op) opt.selected = true;
        }
        const valInput = wrap.createEl('input', {
          cls: 'tcr-input narrow',
          type: 'number',
        });
        valInput.value = String(draft.match.value ?? 1);
        const update = (): void => {
          draft.match = {
            type: 'frequency',
            operator: opSel.value as MatchCriteria['operator'],
            value: Number(valInput.value),
          };
          this.renderPreviewForRule(draft);
        };
        opSel.addEventListener('change', update);
        valInput.addEventListener('input', update);
        break;
      }
      case 'list': {
        wrap.createSpan({ cls: 'tcr-match-lead', text: ' is one of ' });
        const input = wrap.createEl('input', { cls: 'tcr-input wide' });
        input.value = (draft.match.list ?? []).join(', ');
        input.placeholder = 'wip, todo, fixme';
        input.addEventListener('input', () => {
          // Strip a typed leading '#': the engine matches hash-less tag names,
          // so `#wip` entered here would otherwise silently never match (DA-12).
          const list = input.value
            .split(',')
            .map((s) => s.trim())
            .map((s) => (s.startsWith('#') ? s.slice(1) : s))
            .filter(Boolean);
          draft.match = { type: 'list', list };
          this.renderPreviewForRule(draft);
        });
        break;
      }
    }
  }

  // -----------------------------------------------------------------
  // Save / delete / cancel
  // -----------------------------------------------------------------

  private async saveDraft(): Promise<void> {
    const draft = this.draft;
    if (!draft) return;
    if (!draft.name.trim()) {
      new Notice('Rule needs a name.');
      return;
    }
    if (draft.match.type === 'regex' && draft.match.pattern) {
      try {
        compileSafeRegex(draft.match.pattern);
      } catch (e) {
        new Notice('Invalid regex: ' + (e as Error).message);
        return;
      }
    }
    if (this.isNew) {
      await this.plugin.settingsManager.addCustomRule(draft);
      new Notice(`Rule "${draft.name}" created.`);
    } else {
      await this.plugin.settingsManager.updateCustomRule(draft.id, draft);
      new Notice(`Rule "${draft.name}" saved.`);
    }
    this.exitEdit();
  }

  private async deleteDraft(): Promise<void> {
    const draft = this.draft;
    if (!draft || this.isNew) return;
    const ok = await confirmModal(
      this.plugin.app,
      'Delete rule?',
      `"${draft.name}" will be removed. This cannot be undone.`,
    );
    if (!ok) return;
    await this.plugin.settingsManager.deleteCustomRule(draft.id);
    new Notice(`Rule "${draft.name}" deleted.`);
    this.exitEdit();
  }

  private exitEdit(): void {
    this.mode = 'cards';
    this.draft = null;
    this.isNew = false;
    this.render();
  }

  // -----------------------------------------------------------------
  // Right-docked preview
  // -----------------------------------------------------------------

  private renderPreviewVaultWide(): void {
    const s = this.plugin.settingsManager.get();
    const meta = this.plugin.tagMetaManager.all();
    const activeRules = resolveActiveRules(s);

    const head = this.previewEl.createDiv({ cls: 'tcr-pd-head' });
    head.createDiv({ cls: 'tcr-pd-eyebrow', text: 'Preview · vault-wide' });
    head.createDiv({
      cls: 'tcr-pd-title',
      text: 'Every tag any rule is affecting',
    });

    const affected: Array<{ m: TagMeta; ruleLabel: string | null }> = [];
    for (const m of meta.values()) {
      const attr = RuleEngine.getRuleAttribution(m.tag, m, activeRules);
      if (attr.effective) {
        affected.push({ m, ruleLabel: attr.effective.ruleName });
      }
    }

    const totalInstances = affected.reduce((sum, a) => sum + a.m.count, 0);
    this.renderStatRow(head, affected.length, totalInstances);
    head.createDiv({
      cls: 'tcr-pd-sub',
      text: 'In edit mode this list filters to the selected rule.',
    });

    this.previewItems = affected;
    this.previewEmptyMsg = 'No tags currently affected by any rule.';
    this.renderPreviewControls();
    this.previewBodyEl = this.previewEl.createDiv({ cls: 'tcr-pd-body' });
    this.renderPreviewRows();
  }

  private renderPreviewForRule(rule: Rule | null): void {
    this.previewEl.empty();
    const head = this.previewEl.createDiv({ cls: 'tcr-pd-head' });
    head.createDiv({ cls: 'tcr-pd-eyebrow', text: 'Preview · filtered to' });

    if (!rule) {
      head.createDiv({ cls: 'tcr-pd-title', text: 'No rule selected' });
      this.previewBodyEl = null;
      return;
    }

    const titleRow = head.createDiv({ cls: 'tcr-pd-title-row' });
    titleRow.createSpan({ cls: 'tcr-pd-dot' });
    titleRow.createSpan({ text: rule.name || 'Untitled rule' });

    const meta = this.plugin.tagMetaManager.all();
    const matching: Array<{ m: TagMeta; ruleLabel: string | null }> = [];
    for (const m of meta.values()) {
      if (this.testCriteriaOnTag(rule.match, m)) matching.push({ m, ruleLabel: null });
    }

    const totalInstances = matching.reduce((sum, a) => sum + a.m.count, 0);
    this.renderStatRow(head, matching.length, totalInstances);

    head.createDiv({
      cls: 'tcr-pd-sub',
      text: 'Updates as you edit the rule.',
    });

    this.previewItems = matching;
    this.previewEmptyMsg = 'No tags match this rule yet.';
    this.renderPreviewControls();
    this.previewBodyEl = this.previewEl.createDiv({ cls: 'tcr-pd-body' });
    this.renderPreviewRows();
  }

  // The preview list's quick-search box + sortable Tag / Count headers (4-3).
  // Built once per full preview render; typing or clicking a header repaints
  // only the rows (renderPreviewRows), so the search box keeps focus.
  private renderPreviewControls(): void {
    const controls = this.previewEl.createDiv({ cls: 'tcr-pd-controls' });

    const searchWrap = controls.createDiv({ cls: 'tcr-pd-search' });
    const input = searchWrap.createEl('input', {
      type: 'text',
      placeholder: 'Search tags...',
    });
    input.value = this.previewSearch;
    input.addEventListener('input', () => {
      this.previewSearch = input.value;
      this.renderPreviewRows();
    });

    const listHead = controls.createDiv({ cls: 'tcr-pd-listhead' });
    const tagH = listHead.createSpan({ cls: 'tcr-pd-listhead-tag' });
    const countH = listHead.createSpan({ cls: 'tcr-pd-listhead-count' });
    const paint = (): void => {
      const arrow = (active: boolean): string =>
        active ? (this.previewSortDesc ? ' ▼' : ' ▲') : '';
      tagH.setText('Tag' + arrow(this.previewSort === 'name'));
      countH.setText('Count' + arrow(this.previewSort === 'count'));
    };
    paint();
    makeActivatable(tagH, () => {
      if (this.previewSort === 'name') this.previewSortDesc = !this.previewSortDesc;
      else {
        this.previewSort = 'name';
        this.previewSortDesc = false;
      }
      paint();
      this.renderPreviewRows();
    });
    makeActivatable(countH, () => {
      if (this.previewSort === 'count') this.previewSortDesc = !this.previewSortDesc;
      else {
        this.previewSort = 'count';
        this.previewSortDesc = true;
      }
      paint();
      this.renderPreviewRows();
    });
  }

  // Repaint just the preview rows from previewItems + the current search/sort.
  private renderPreviewRows(): void {
    const body = this.previewBodyEl;
    if (!body) return;
    body.empty();

    if (this.previewItems.length === 0) {
      body.createDiv({ cls: 'tcr-pd-empty', text: this.previewEmptyMsg });
      return;
    }

    const term = this.previewSearch.trim().toLowerCase();
    const items = this.previewItems
      .filter((it) => !term || it.m.tag.toLowerCase().includes(term))
      .sort((a, b) =>
        this.previewSort === 'name'
          ? (this.previewSortDesc
              ? b.m.tag.localeCompare(a.m.tag)
              : a.m.tag.localeCompare(b.m.tag))
          : (this.previewSortDesc ? b.m.count - a.m.count : a.m.count - b.m.count),
      );

    if (items.length === 0) {
      body.createDiv({ cls: 'tcr-pd-empty', text: 'No tags match your search.' });
      return;
    }

    for (const it of items) {
      this.previewRow(body, it.m, it.ruleLabel);
    }
  }

  // A single preview row with an info-icon accordion. The collapsed row shows
  // tag + count; expanding reveals a key/value detail panel plus per-tag
  // "Always show / Always hide" override pins (D-015). Used by both the
  // vault-wide and rule-filtered previews; ruleLabel is null in edit mode where
  // the list is already filtered to one rule.
  private previewRow(
    body: HTMLElement,
    m: TagMeta,
    ruleLabel: string | null,
  ): void {
    const item = body.createDiv({ cls: 'tcr-pd-item' });
    const row = item.createDiv({ cls: 'tcr-pd-row' });
    row.createSpan({ cls: 'tcr-pd-tag', text: m.tag });
    row.createSpan({ cls: 'tcr-pd-count', text: String(m.count) });
    const info = row.createSpan({ cls: 'tcr-pd-info', text: 'ⓘ' });
    info.setAttribute('aria-label', `Details for ${m.tag}`);

    const open = this.openPreviewTags.has(m.tag);
    const detail = item.createDiv({ cls: 'tcr-pd-detail' });
    if (!open) detail.addClass('tcr-pd-detail-collapsed');
    if (open) info.addClass('open');

    const kv = detail.createDiv({ cls: 'tcr-pd-kv' });
    if (ruleLabel) this.kvRow(kv, 'Affected by', ruleLabel);
    this.kvRow(kv, 'Notes', String(m.count));
    this.kvRow(kv, 'First seen', formatPreviewDate(m.firstSeen));
    this.kvRow(kv, 'Last indexed', formatPreviewDate(m.lastSeen));
    this.renderOverrideActions(detail, m.tag);

    makeActivatable(info, (e) => {
      e.stopPropagation();
      if (this.openPreviewTags.has(m.tag)) {
        this.openPreviewTags.delete(m.tag);
        detail.addClass('tcr-pd-detail-collapsed');
        info.removeClass('open');
      } else {
        this.openPreviewTags.add(m.tag);
        detail.removeClass('tcr-pd-detail-collapsed');
        info.addClass('open');
      }
    });
  }

  private kvRow(parent: HTMLElement, key: string, value: string): void {
    const r = parent.createDiv({ cls: 'tcr-pd-kv-row' });
    r.createSpan({ cls: 'tcr-pd-kv-key', text: key });
    r.createSpan({ cls: 'tcr-pd-kv-val', text: value });
  }

  private renderOverrideActions(parent: HTMLElement, tag: string): void {
    const overrides = this.plugin.settingsManager.get().overrides;
    // Own-property guard (DA-08): see RuleEngine.resolveVisibility.
    const current = Object.hasOwn(overrides, tag) ? overrides[tag] : undefined;
    const wrap = parent.createDiv({ cls: 'tcr-pd-ov' });
    wrap.createSpan({ cls: 'tcr-pd-kv-key', text: 'Override' });
    const btns = wrap.createDiv({ cls: 'tcr-pd-ov-btns' });

    const showBtn = btns.createEl('button', {
      cls: 'tcr-pd-ov-btn',
      text: 'Always show',
    });
    if (current === 'show') showBtn.addClass('on');
    showBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.plugin.settingsManager.setOverride(
        tag,
        current === 'show' ? null : 'show',
      );
    });

    const hideBtn = btns.createEl('button', {
      cls: 'tcr-pd-ov-btn',
      text: 'Always hide',
    });
    if (current === 'hide') hideBtn.addClass('on');
    hideBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.plugin.settingsManager.setOverride(
        tag,
        current === 'hide' ? null : 'hide',
      );
    });
  }

  private renderStatRow(
    parent: HTMLElement,
    unique: number,
    totalInstances: number,
  ): void {
    const stats = parent.createDiv({ cls: 'tcr-pd-stats' });
    this.statCard(stats, 'Unique tags', unique);
    this.statCard(stats, 'Total instances', totalInstances);
  }

  private statCard(parent: HTMLElement, label: string, value: number): void {
    const c = parent.createDiv({ cls: 'tcr-pd-stat' });
    c.createDiv({ cls: 'tcr-pd-stat-label', text: label });
    c.createDiv({ cls: 'tcr-pd-stat-value', text: value.toLocaleString() });
  }

  // -----------------------------------------------------------------
  // Affected-tag computation
  // -----------------------------------------------------------------

  private countAffectedForRule(rule: Rule): number {
    if (!rule.enabled) return 0;
    let count = 0;
    for (const m of this.plugin.tagMetaManager.all().values()) {
      if (this.testCriteriaOnTag(rule.match, m)) count += 1;
    }
    return count;
  }

  private testCriteriaOnTag(criteria: MatchCriteria, m: TagMeta): boolean {
    if (criteria.type === 'frequency') {
      return frequencyMatchesMeta(criteria, m);
    }
    const synthetic: Rule = {
      id: 'preview',
      name: 'preview',
      enabled: true,
      priority: 0,
      match: criteria,
      action: 'hide',
    };
    try {
      return RuleEngine.testTag(m.tag, synthetic);
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------
  // Tiny DOM helpers
  // -----------------------------------------------------------------

  private section(
    parent: HTMLElement,
    label: string,
    build: (sec: HTMLElement) => void,
  ): void {
    const sec = parent.createDiv({ cls: 'tcr-section' });
    sec.createDiv({ cls: 'tcr-section-label', text: label });
    build(sec);
  }

  private row(sec: HTMLElement): HTMLElement {
    return sec.createDiv({ cls: 'tcr-row' });
  }

  private label(row: HTMLElement, text: string): HTMLElement {
    return row.createDiv({ cls: 'tcr-label', text });
  }

  private control(row: HTMLElement): HTMLElement {
    return row.createDiv({ cls: 'tcr-control' });
  }

  private attachHelp(parent: HTMLElement, text: string): void {
    const ic = parent.createSpan({ cls: 'tcr-help-ic', text: '?' });
    const tip = ic.createDiv({ cls: 'tcr-tip' });
    tip.setText(text);
  }

  private makeToggle(
    parent: HTMLElement,
    initial: boolean,
    onChange: (next: boolean) => Promise<void> | void,
    ariaLabel?: string,
  ): HTMLElement {
    const t = parent.createDiv({ cls: 'tcr-toggle' });
    t.toggleClass('on', initial);
    setSwitchState(t, initial);
    makeActivatable(
      t,
      (e) => {
        e.stopPropagation();
        const next = !t.hasClass('on');
        t.toggleClass('on', next);
        setSwitchState(t, next);
        void onChange(next);
      },
      { role: 'switch', ariaLabel },
    );
    return t;
  }
}

// =================================================================
// Helpers
// =================================================================

function matchSummaryString(match: MatchCriteria): string {
  switch (match.type) {
    case 'regex':
      return match.pattern ? `matches /${match.pattern}/` : '(no pattern set)';
    case 'frequency': {
      const op = match.operator ?? '=';
      return `when count ${op} ${match.value ?? 0}`;
    }
    case 'list': {
      const list = match.list ?? [];
      if (list.length === 0) return '(no tags listed)';
      if (list.length <= 3) return list.map((t) => `\`${t}\``).join(', ');
      return `${list.length} tags: ${list
        .slice(0, 3)
        .map((t) => `\`${t}\``)
        .join(', ')}...`;
    }
  }
}

function blankCriteriaFor(type: MatchType): MatchCriteria {
  switch (type) {
    case 'regex':
      return { type: 'regex', pattern: '' };
    case 'frequency':
      return { type: 'frequency', operator: '<=', value: 1 };
    case 'list':
      return { type: 'list', list: [] };
  }
}

function formatPreviewDate(ms: number): string {
  if (!ms) return 'n/a';
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function frequencyMatchesMeta(criteria: MatchCriteria, m: TagMeta): boolean {
  if (criteria.type !== 'frequency') return false;
  const op = criteria.operator ?? '=';
  const v = criteria.value ?? 0;
  switch (op) {
    case '<':
      return m.count < v;
    case '<=':
      return m.count <= v;
    case '=':
      return m.count === v;
    case '>=':
      return m.count >= v;
    case '>':
      return m.count > v;
  }
}

async function confirmModal(
  app: App,
  title: string,
  message: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new (class extends Modal {
      onOpen(): void {
        this.titleEl.setText(title);
        const body = this.contentEl.createDiv();
        body.createDiv({ text: message });
        const foot = this.contentEl.createDiv({ cls: 'tcr-confirm-foot' });
        const cancel = foot.createEl('button', { text: 'Cancel' });
        cancel.addEventListener('click', () => {
          resolve(false);
          this.close();
        });
        const ok = foot.createEl('button', {
          text: 'Delete',
          cls: 'mod-warning',
        });
        ok.addEventListener('click', () => {
          resolve(true);
          this.close();
        });
      }
      onClose(): void {
        this.contentEl.empty();
      }
    })(app);
    modal.open();
  });
}
