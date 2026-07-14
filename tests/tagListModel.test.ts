import { describe, expect, it } from 'vitest';
import { TagListModel, TagListDataSource } from '../src/ui/tagList/tagListModel';
import { DEFAULT_SETTINGS, TagCuratorSettings, TagMeta, Rule } from '../src/types';

function meta(tag: string, overrides: Partial<TagMeta> = {}): TagMeta {
  return { tag, firstSeen: 0, lastSeen: 0, count: 1, sources: ['inline'], ...overrides };
}

function hideRule(tag: string): Rule {
  return {
    id: 'h-' + tag,
    name: 'hide ' + tag,
    enabled: true,
    priority: 50,
    match: { type: 'list', list: [tag] },
    action: 'hide',  };
}

function flagRule(tag: string): Rule {
  return {
    id: 'f-' + tag,
    name: 'flag ' + tag,
    enabled: true,
    priority: 50,
    match: { type: 'list', list: [tag] },
    action: 'flag',
  };
}

function source(
  metas: TagMeta[],
  settings: Partial<TagCuratorSettings> = {},
): TagListDataSource {
  const map = new Map(metas.map((m) => [m.tag, m]));
  const s: TagCuratorSettings = { ...DEFAULT_SETTINGS, enabledPresets: [], ...settings };
  return { getSettings: () => s, getMeta: () => map };
}

describe('TagListModel.allRows', () => {
  it('marks an unmatched tag shown and a rule-matched tag hidden', () => {
    const model = new TagListModel(
      source([meta('keep'), meta('drop')], { customRules: [hideRule('drop')] }),
    );
    const rows = model.allRows();
    expect(rows.find((r) => r.meta.tag === 'keep')!.visibility).toBe('shown');
    expect(rows.find((r) => r.meta.tag === 'drop')!.visibility).toBe('hidden');
  });

  it('marks a matched tag flagged (not hidden) when preview mode is on', () => {
    const model = new TagListModel(
      source([meta('drop')], { customRules: [hideRule('drop')], previewMode: true }),
    );
    expect(model.allRows()[0].visibility).toBe('flagged');
  });

  it('marks a flag-rule tag with marked visibility (visible, not hidden)', () => {
    const model = new TagListModel(
      source([meta('flagme')], { customRules: [flagRule('flagme')] }),
    );
    expect(model.allRows()[0].visibility).toBe('marked');
  });

  it('keeps a flag-rule tag marked in preview mode (preview-independent)', () => {
    const model = new TagListModel(
      source([meta('flagme')], { customRules: [flagRule('flagme')], previewMode: true }),
    );
    expect(model.allRows()[0].visibility).toBe('marked');
  });

  it('attaches every matching rule name to the row', () => {
    const model = new TagListModel(
      source([meta('drop')], { customRules: [hideRule('drop')] }),
    );
    expect(model.allRows()[0].matches.map((m) => m.ruleName)).toContain('hide drop');
  });

  it('an always-show override un-hides a rule-matched tag', () => {
    const model = new TagListModel(
      source([meta('drop')], {
        customRules: [hideRule('drop')],
        overrides: { drop: 'show' },
      }),
    );
    expect(model.allRows()[0].visibility).toBe('shown');
  });

  it('an always-hide override hides an unmatched tag', () => {
    const model = new TagListModel(
      source([meta('keep')], { overrides: { keep: 'hide' } }),
    );
    expect(model.allRows()[0].visibility).toBe('hidden');
  });

  it('an always-hide override flags (not hides) an unmatched tag in preview mode', () => {
    const model = new TagListModel(
      source([meta('keep')], { overrides: { keep: 'hide' }, previewMode: true }),
    );
    expect(model.allRows()[0].visibility).toBe('flagged');
  });
});

describe('TagListModel filtering and search', () => {
  it('hidden chip keeps hide-intent tags and excludes flag (marked) tags', () => {
    const model = new TagListModel(
      source([meta('keep'), meta('drop'), meta('flagme')], {
        customRules: [hideRule('drop'), flagRule('flagme')],
      }),
    );
    model.setFilter('hidden');
    // 'drop' is a hide rule (hide-intent); 'flagme' is a flag rule (marked, still
    // visible) and must NOT appear under Hidden (#4); 'keep' is shown.
    expect(model.rows().map((r) => r.meta.tag)).toEqual(['drop']);
  });

  it('hidden chip keeps a preview-flagged (hide-intent) tag', () => {
    const model = new TagListModel(
      source([meta('keep'), meta('drop')], {
        customRules: [hideRule('drop')],
        previewMode: true,
      }),
    );
    // In preview mode a hide-intent tag paints 'flagged', but it is still a hide,
    // so it belongs under Hidden, not Visible.
    model.setFilter('hidden');
    expect(model.rows().map((r) => r.meta.tag)).toEqual(['drop']);
  });

  it('orphans chip keeps only count <= 1', () => {
    const model = new TagListModel(
      source([meta('rare', { count: 1 }), meta('common', { count: 9 })]),
    );
    model.setFilter('orphans');
    expect(model.rows().map((r) => r.meta.tag)).toEqual(['rare']);
  });

  it('frontmatter chip keeps only frontmatter-only tags', () => {
    const model = new TagListModel(
      source([
        meta('fm', { sources: ['frontmatter'] }),
        meta('both', { sources: ['frontmatter', 'inline'] }),
      ]),
    );
    model.setFilter('frontmatter');
    expect(model.rows().map((r) => r.meta.tag)).toEqual(['fm']);
  });

  it('unreviewed chip keeps only rows without reviewed=true', () => {
    const model = new TagListModel(
      source([meta('new'), meta('done', { reviewed: true })]),
    );
    model.setFilter('unreviewed');
    expect(model.rows().map((r) => r.meta.tag)).toEqual(['new']);
  });

  it('flagged chip keeps flag-rule (marked) rows', () => {
    const model = new TagListModel(
      source([meta('keep'), meta('flagme')], { customRules: [flagRule('flagme')] }),
    );
    model.setFilter('flagged');
    expect(model.rows().map((r) => r.meta.tag)).toEqual(['flagme']);
  });

  it('flagged chip excludes preview-flagged hide-intent rows (they belong to Hidden)', () => {
    const model = new TagListModel(
      source([meta('drop'), meta('flagme')], {
        customRules: [hideRule('drop'), flagRule('flagme')],
        previewMode: true,
      }),
    );
    // 'drop' is a hide rule painted 'flagged' by preview: hide-intent, so it stays
    // under Hidden. Only 'flagme' (the flag action) is Flagged, so each tag lands
    // in exactly one of Visible / Hidden / Flagged.
    model.setFilter('flagged');
    expect(model.rows().map((r) => r.meta.tag)).toEqual(['flagme']);
  });

  it('shown chip keeps only rows whose visibility is shown', () => {
    const model = new TagListModel(
      source([meta('keep'), meta('drop')], { customRules: [hideRule('drop')] }),
    );
    model.setFilter('shown');
    const rows = model.rows();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.visibility === 'shown')).toBe(true);
  });

  it('inline chip keeps only inline-only rows (not frontmatter)', () => {
    const model = new TagListModel(
      source([
        meta('inl', { sources: ['inline'] }),
        meta('fm', { sources: ['frontmatter'] }),
        meta('both', { sources: ['frontmatter', 'inline'] }),
      ]),
    );
    model.setFilter('inline');
    expect(model.rows().map((r) => r.meta.tag)).toEqual(['inl']);
  });

  it('setRuleFilter keeps only rows matched by that rule id; null clears it', () => {
    const model = new TagListModel(
      source([meta('a'), meta('b'), meta('c')], {
        customRules: [hideRule('a'), hideRule('b')],
      }),
    );
    model.setRuleFilter('h-a');
    expect(model.rows().map((r) => r.meta.tag)).toEqual(['a']);
    model.setRuleFilter(null);
    expect(model.rows().map((r) => r.meta.tag).sort()).toEqual(['a', 'b', 'c']);
  });

  it('search is a case-insensitive substring on the tag name', () => {
    const model = new TagListModel(source([meta('Project'), meta('area')]));
    model.setSearch('PROJ');
    expect(model.rows().map((r) => r.meta.tag)).toEqual(['Project']);
  });
});

describe('TagListModel sorting', () => {
  it('sorts by count descending by default', () => {
    const model = new TagListModel(
      source([meta('a', { count: 2 }), meta('b', { count: 9 })]),
    );
    expect(model.rows().map((r) => r.meta.tag)).toEqual(['b', 'a']);
  });

  it('setSort toggles direction when the same key is set again', () => {
    const model = new TagListModel(
      source([meta('a', { count: 2 }), meta('b', { count: 9 })]),
    );
    model.setSort('count');
    expect(model.rows().map((r) => r.meta.tag)).toEqual(['a', 'b']);
  });

  it('sorts by name ascending', () => {
    const model = new TagListModel(source([meta('zebra'), meta('apple')]));
    model.setSort('name', false);
    expect(model.rows().map((r) => r.meta.tag)).toEqual(['apple', 'zebra']);
  });
});

describe('TagListModel selection and lookup', () => {
  it('toggleSelect adds then removes a tag', () => {
    const model = new TagListModel(source([meta('a')]));
    model.toggleSelect('a');
    expect([...model.selection]).toEqual(['a']);
    model.toggleSelect('a');
    expect([...model.selection]).toEqual([]);
  });

  it('clearSelection empties the set', () => {
    const model = new TagListModel(source([meta('a'), meta('b')]));
    model.toggleSelect('a');
    model.toggleSelect('b');
    model.clearSelection();
    expect(model.selection.size).toBe(0);
  });

  it('rowFor returns the row for a tag or undefined', () => {
    const model = new TagListModel(source([meta('a')]));
    expect(model.rowFor('a')!.meta.tag).toBe('a');
    expect(model.rowFor('missing')).toBeUndefined();
  });

  it('selectAllMatching selects only the current filtered set, not all rows', () => {
    const model = new TagListModel(
      source([meta('keep'), meta('drop')], { customRules: [hideRule('drop')] }),
    );
    model.setFilter('hidden');
    model.selectAllMatching();
    expect([...model.selection]).toEqual(['drop']);
  });

  it('selectAllMatching is additive across filter changes', () => {
    const model = new TagListModel(
      source([meta('a'), meta('b'), meta('c')]),
    );
    model.setSearch('a');
    model.selectAllMatching();
    model.setSearch('b');
    model.selectAllMatching();
    expect([...model.selection].sort()).toEqual(['a', 'b']);
  });

  it('deselectAllMatching removes only the current filtered set', () => {
    const model = new TagListModel(
      source([meta('keep'), meta('drop')], { customRules: [hideRule('drop')] }),
    );
    model.selectAllMatching(); // selects keep + drop (filter is 'all')
    model.setFilter('hidden');
    model.deselectAllMatching(); // removes only 'drop'
    expect([...model.selection]).toEqual(['keep']);
  });

  it('allMatchingSelected is true only when every filtered row is selected', () => {
    const model = new TagListModel(source([meta('a'), meta('b')]));
    expect(model.allMatchingSelected()).toBe(false);
    model.toggleSelect('a');
    expect(model.allMatchingSelected()).toBe(false);
    model.toggleSelect('b');
    expect(model.allMatchingSelected()).toBe(true);
  });

  it('allMatchingSelected is false for an empty filtered set', () => {
    const model = new TagListModel(source([meta('a')]));
    model.setSearch('zzz');
    expect(model.allMatchingSelected()).toBe(false);
  });
});
