import { describe, expect, it } from 'vitest';
import { RuleEngine } from '../src/engine/ruleEngine';
import { Action, Rule, TagMeta, TagOverride } from '../src/types';

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

function meta(tag: string, count = 5): TagMeta {
  return { tag, firstSeen: 0, lastSeen: 0, count, sources: ['inline'] };
}

function metaMap(...tags: TagMeta[]): Map<string, TagMeta> {
  const m = new Map<string, TagMeta>();
  for (const t of tags) m.set(t.tag, t);
  return m;
}

describe('RuleEngine.evaluateTag', () => {
  it('returns null when no rule matches', () => {
    const result = RuleEngine.evaluateTag('miss', undefined, [
      rule({ id: 'a', match: { type: 'list', list: ['other'] } }),
    ]);
    expect(result).toBeNull();
  });

  it('skips disabled rules', () => {
    const result = RuleEngine.evaluateTag('t', undefined, [
      rule({ id: 'a', enabled: false }),
    ]);
    expect(result).toBeNull();
  });

  it('returns the matching rule when one matches', () => {
    const result = RuleEngine.evaluateTag('t', undefined, [rule({ id: 'a', name: 'A' })]);
    expect(result).toEqual({ matched: true, ruleId: 'a', ruleName: 'A' });
  });

  it('the highest-priority matching rule wins', () => {
    // Rules sorted priority-desc, then first match wins. Higher priority number
    // = more important. Lower-priority rules never override a higher-priority match.
    const rules: Rule[] = [
      rule({ id: 'high', name: 'high', priority: 100 }),
      rule({ id: 'mid', name: 'mid', priority: 50 }),
      rule({ id: 'low', name: 'low', priority: 10 }),
    ];
    const result = RuleEngine.evaluateTag('t', undefined, rules);
    expect(result).toEqual({ matched: true, ruleId: 'high', ruleName: 'high' });
  });

  it('does not consider disabled rules even when they have highest priority', () => {
    const rules: Rule[] = [
      rule({ id: 'top', name: 'top', priority: 999, enabled: false }),
      rule({ id: 'mid', name: 'mid', priority: 50 }),
    ];
    const result = RuleEngine.evaluateTag('t', undefined, rules);
    expect(result?.ruleId).toBe('mid');
  });

  it('does not mutate input rules array', () => {
    const rules: Rule[] = [
      rule({ id: 'a', priority: 1 }),
      rule({ id: 'b', priority: 2 }),
    ];
    const before = rules.map((r) => r.id);
    RuleEngine.evaluateTag('t', undefined, rules);
    expect(rules.map((r) => r.id)).toEqual(before);
  });
});

describe('RuleEngine.getAllMatches', () => {
  it('returns every matching enabled rule in iteration order', () => {
    const rules: Rule[] = [
      rule({ id: 'a' }),
      rule({ id: 'b' }),
      rule({ id: 'c', match: { type: 'list', list: ['other'] } }),
    ];
    const matches = RuleEngine.getAllMatches('t', undefined, rules);
    expect(matches.map((m) => m.ruleId)).toEqual(['a', 'b']);
  });

  it('returns empty when nothing matches', () => {
    const matches = RuleEngine.getAllMatches('miss', undefined, [rule()]);
    expect(matches).toEqual([]);
  });
});

describe('RuleEngine.testTag', () => {
  it('matches without metadata', () => {
    expect(RuleEngine.testTag('t', rule())).toBe(true);
  });

  it('frequency rule returns false when no metadata is supplied', () => {
    const r = rule({ match: { type: 'frequency', operator: '<=', value: 1 } });
    expect(RuleEngine.testTag('t', r)).toBe(false);
  });
});

describe('RuleEngine.getRuleAttribution', () => {
  it('returns empty attribution when nothing matches', () => {
    const result = RuleEngine.getRuleAttribution('miss', undefined, [
      rule({ id: 'a', match: { type: 'list', list: ['other'] } }),
    ]);
    expect(result).toEqual({ tag: 'miss', effective: null, allMatches: [] });
  });

  it('effective rule is the highest-priority match; allMatches ordered priority-desc', () => {
    const rules: Rule[] = [
      rule({ id: 'high', name: 'high', priority: 100 }),
      rule({ id: 'mid', name: 'mid', priority: 50 }),
      rule({ id: 'low', name: 'low', priority: 10 }),
    ];
    const result = RuleEngine.getRuleAttribution('t', undefined, rules);
    expect(result.effective?.ruleId).toBe('high');
    expect(result.allMatches.map((m) => m.ruleId)).toEqual(['high', 'mid', 'low']);
  });

  it('skips disabled rules in both the chain and the effective slot', () => {
    const rules: Rule[] = [
      rule({ id: 'on', priority: 100 }),
      rule({ id: 'off', priority: 50, enabled: false }),
    ];
    const result = RuleEngine.getRuleAttribution('t', undefined, rules);
    expect(result.allMatches.map((m) => m.ruleId)).toEqual(['on']);
    expect(result.effective?.ruleId).toBe('on');
  });

  it('describes a regex reason with the pattern', () => {
    const r = rule({ id: 'rx', match: { type: 'regex', pattern: '^foo$' } });
    const result = RuleEngine.getRuleAttribution('foo', undefined, [r]);
    expect(result.effective?.reason).toBe('matches /^foo$/');
  });

  it('describes a frequency reason with the count and operator', () => {
    const r = rule({ id: 'fr', match: { type: 'frequency', operator: '<=', value: 1 } });
    const meta = {
      tag: 't',
      firstSeen: 0,
      lastSeen: 0,
      count: 1,
      sources: ['inline' as const],
    };
    const result = RuleEngine.getRuleAttribution('t', meta, [r]);
    expect(result.effective?.reason).toBe('count 1 <= 1');
  });

  it('describes a list reason', () => {
    const r = rule({ id: 'ls', match: { type: 'list', list: ['t'] } });
    const result = RuleEngine.getRuleAttribution('t', undefined, [r]);
    expect(result.effective?.reason).toBe('exact match in list');
  });

  it('includes action, priority, and builtin in attribution, with no scopes', () => {
    const r = rule({
      id: 'a',
      action: 'hide',
      priority: 42,
      builtin: true,
    });
    const result = RuleEngine.getRuleAttribution('t', undefined, [r]);
    expect(result.effective).toMatchObject({
      ruleId: 'a',
      action: 'hide',
      priority: 42,
      builtin: true,
    });
    expect(result.effective).not.toHaveProperty('scopes');
  });

  it('treats missing builtin flag as false', () => {
    const r = rule({ id: 'custom' });
    delete (r as { builtin?: boolean }).builtin;
    const result = RuleEngine.getRuleAttribution('t', undefined, [r]);
    expect(result.effective?.builtin).toBe(false);
  });

  it('does not mutate the input rules array', () => {
    const rules: Rule[] = [
      rule({ id: 'a', priority: 1 }),
      rule({ id: 'b', priority: 2 }),
    ];
    const before = rules.map((r) => r.id);
    RuleEngine.getRuleAttribution('t', undefined, rules);
    expect(rules.map((r) => r.id)).toEqual(before);
  });
});

describe('RuleEngine.countByIntent (hide vs flag split, scope-independent)', () => {
  it('counts a hide-rule tag as hide, not flag, and ignores shown tags', () => {
    const rules: Rule[] = [rule({ id: 'h', match: { type: 'list', list: ['hidden'] } })];
    const map = metaMap(meta('hidden'), meta('shown'));
    expect(RuleEngine.countByIntent(map, rules, {})).toEqual({ hide: 1, flag: 0 });
  });

  it('separates flag-action tags from hide-action tags', () => {
    const rules: Rule[] = [
      rule({ id: 'h', action: 'hide', match: { type: 'list', list: ['hideme'] } }),
      rule({ id: 'f', action: 'flag', match: { type: 'list', list: ['flagme'] } }),
    ];
    const map = metaMap(meta('hideme'), meta('flagme'), meta('plain'));
    expect(RuleEngine.countByIntent(map, rules, {})).toEqual({ hide: 1, flag: 1 });
  });

  it('returns zeros when no tag matches any rule and there are no overrides', () => {
    const rules: Rule[] = [rule({ id: 'h', match: { type: 'list', list: ['nope'] } })];
    const map = metaMap(meta('a'), meta('b'), meta('c'));
    expect(RuleEngine.countByIntent(map, rules, {})).toEqual({ hide: 0, flag: 0 });
  });

  it('does NOT count an always-show override even when a rule matches', () => {
    // always-show is the safety net: the tag stays visible, so it is not curated.
    const rules: Rule[] = [rule({ id: 'h', match: { type: 'list', list: ['x'] } })];
    const overrides: Record<string, TagOverride> = { x: 'show' };
    const map = metaMap(meta('x'));
    expect(RuleEngine.countByIntent(map, rules, overrides)).toEqual({ hide: 0, flag: 0 });
  });

  it('counts an always-hide override as hide even when no rule matches', () => {
    const overrides: Record<string, TagOverride> = { y: 'hide' };
    const map = metaMap(meta('y'), meta('z'));
    expect(RuleEngine.countByIntent(map, [], overrides)).toEqual({ hide: 1, flag: 0 });
  });

  it('is preview-mode-independent: the matched SETS are intrinsic to rules', () => {
    // The split is a property of rules + overrides; preview mode only changes how
    // those tags are decorated, never which tags land in which bucket.
    const rules: Rule[] = [
      rule({ id: 'h', match: { type: 'list', list: ['a', 'b'] } }),
      rule({ id: 'f', action: 'flag', match: { type: 'list', list: ['c'] } }),
    ];
    const map = metaMap(meta('a'), meta('b'), meta('c'), meta('d'));
    expect(RuleEngine.countByIntent(map, rules, {})).toEqual({ hide: 2, flag: 1 });
  });

  it('returns zeros for an empty metadata map', () => {
    expect(RuleEngine.countByIntent(new Map(), [rule()], {})).toEqual({ hide: 0, flag: 0 });
  });
});

describe('RuleEngine.resolveDecoration (single hidden/flagged/marked decision)', () => {
  it('returns null when nothing matches (shown)', () => {
    expect(RuleEngine.resolveDecoration(null, false)).toBeNull();
    expect(RuleEngine.resolveDecoration(null, true)).toBeNull();
  });

  it('returns null for an always-show override in both modes (kept visible)', () => {
    const eff = RuleEngine.resolveVisibility('t', undefined, [], { t: 'show' }).effective;
    expect(RuleEngine.resolveDecoration(eff, false)).toBeNull();
    expect(RuleEngine.resolveDecoration(eff, true)).toBeNull();
  });

  it('marks a flag-action match in both modes (preview-independent)', () => {
    const eff = RuleEngine.getRuleAttribution('t', undefined, [rule({ action: 'flag' })]).effective;
    expect(RuleEngine.resolveDecoration(eff, false)).toBe('marked');
    expect(RuleEngine.resolveDecoration(eff, true)).toBe('marked');
  });

  it('hides a hide-action match normally and flags it in preview', () => {
    const eff = RuleEngine.getRuleAttribution('t', undefined, [rule({ action: 'hide' })]).effective;
    expect(RuleEngine.resolveDecoration(eff, false)).toBe('hidden');
    expect(RuleEngine.resolveDecoration(eff, true)).toBe('flagged');
  });

  it('degrades a deferred show-only / group action to the hide branch', () => {
    for (const action of ['show-only', 'group'] as Action[]) {
      const eff = RuleEngine.getRuleAttribution('t', undefined, [rule({ action })]).effective;
      expect(RuleEngine.resolveDecoration(eff, false)).toBe('hidden');
      expect(RuleEngine.resolveDecoration(eff, true)).toBe('flagged');
    }
  });

  it('hides an always-hide override normally and flags it in preview', () => {
    const eff = RuleEngine.resolveVisibility('t', undefined, [], { t: 'hide' }).effective;
    expect(RuleEngine.resolveDecoration(eff, false)).toBe('hidden');
    expect(RuleEngine.resolveDecoration(eff, true)).toBe('flagged');
  });
});
