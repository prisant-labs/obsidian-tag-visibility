import { describe, expect, it } from 'vitest';
import { PRESETS, getPresetById, resolveActiveRules } from '../src/engine/presets';
import { TagMatcher } from '../src/engine/matchers';
import { DEFAULT_SETTINGS, Rule, TagCuratorSettings, TagMeta } from '../src/types';

function meta(count: number): TagMeta {
  return {
    tag: 't',
    firstSeen: 0,
    lastSeen: 0,
    count,
    sources: ['inline'],
  };
}

describe('PRESETS catalog', () => {
  it('exports the five v0.1.0 presets', () => {
    const ids = PRESETS.map((p) => p.id).sort();
    expect(ids).toEqual(
      ['hide-hex-codes', 'hide-numeric', 'hide-orphans', 'hide-single-char', 'hide-url-anchors'],
    );
  });

  it('only hex-codes and url-anchors are enabled by default', () => {
    const enabled = PRESETS.filter((p) => p.rule.enabled).map((p) => p.id).sort();
    expect(enabled).toEqual(['hide-hex-codes', 'hide-url-anchors']);
  });

  it('every preset rule hides and is builtin, with no per-rule scope', () => {
    for (const p of PRESETS) {
      expect(p.rule).not.toHaveProperty('scopes');
      expect(p.rule.action).toBe('hide');
      expect(p.rule.builtin).toBe(true);
    }
  });

  it('priorities are descending and unique', () => {
    const priorities = PRESETS.map((p) => p.rule.priority);
    const sorted = [...priorities].sort((a, b) => b - a);
    expect(priorities).toEqual(sorted);
    expect(new Set(priorities).size).toBe(priorities.length);
  });
});

describe('preset matchers', () => {
  it('hide-hex-codes matches 3-8 hex digits, case-insensitive', () => {
    const r = getPresetById('hide-hex-codes')!.rule;
    expect(TagMatcher.matches('FFAA00', undefined, r.match)).toBe(true);
    expect(TagMatcher.matches('abc', undefined, r.match)).toBe(true);
    expect(TagMatcher.matches('aBcDeF', undefined, r.match)).toBe(true);
    expect(TagMatcher.matches('ab', undefined, r.match)).toBe(false); // too short
    expect(TagMatcher.matches('123456789', undefined, r.match)).toBe(false); // too long
    expect(TagMatcher.matches('ghijkl', undefined, r.match)).toBe(false); // not hex
  });

  it('hide-url-anchors matches common fragment words and word-numeric pattern', () => {
    const r = getPresetById('hide-url-anchors')!.rule;
    expect(TagMatcher.matches('top', undefined, r.match)).toBe(true);
    expect(TagMatcher.matches('section-3', undefined, r.match)).toBe(true);
    expect(TagMatcher.matches('chapter-12', undefined, r.match)).toBe(true);
    expect(TagMatcher.matches('topology', undefined, r.match)).toBe(false);
    expect(TagMatcher.matches('section-3-extra', undefined, r.match)).toBe(false);
  });

  it('hide-single-char matches one ASCII letter', () => {
    const r = getPresetById('hide-single-char')!.rule;
    expect(TagMatcher.matches('a', undefined, r.match)).toBe(true);
    expect(TagMatcher.matches('Z', undefined, r.match)).toBe(true);
    expect(TagMatcher.matches('ab', undefined, r.match)).toBe(false);
    expect(TagMatcher.matches('1', undefined, r.match)).toBe(false);
  });

  it('hide-numeric matches digits only', () => {
    const r = getPresetById('hide-numeric')!.rule;
    expect(TagMatcher.matches('2024', undefined, r.match)).toBe(true);
    expect(TagMatcher.matches('0', undefined, r.match)).toBe(true);
    expect(TagMatcher.matches('2024a', undefined, r.match)).toBe(false);
  });

  it('hide-orphans uses frequency <= 1', () => {
    const r = getPresetById('hide-orphans')!.rule;
    expect(TagMatcher.matches('t', meta(0), r.match)).toBe(true);
    expect(TagMatcher.matches('t', meta(1), r.match)).toBe(true);
    expect(TagMatcher.matches('t', meta(2), r.match)).toBe(false);
  });
});

describe('getPresetById', () => {
  it('returns the preset when id is known', () => {
    expect(getPresetById('hide-hex-codes')?.id).toBe('hide-hex-codes');
  });

  it('returns undefined when id is unknown', () => {
    expect(getPresetById('nope')).toBeUndefined();
  });
});

describe('resolveActiveRules', () => {
  function settingsWith(overrides: Partial<TagCuratorSettings>): TagCuratorSettings {
    return { ...DEFAULT_SETTINGS, ...overrides };
  }

  it('returns only enabled presets, force-enabled', () => {
    const result = resolveActiveRules(settingsWith({ enabledPresets: ['hide-orphans'] }));
    expect(result.map((r) => r.id)).toEqual(['hide-orphans']);
    expect(result[0].enabled).toBe(true);
  });

  it('ignores enabledPresets entries that do not exist', () => {
    const result = resolveActiveRules(settingsWith({ enabledPresets: ['nope', 'hide-hex-codes'] }));
    expect(result.map((r) => r.id)).toEqual(['hide-hex-codes']);
  });

  it('includes only enabled custom rules', () => {
    const custom: Rule[] = [
      {
        id: 'c1',
        name: 'enabled custom',
        enabled: true,
        priority: 200,
        match: { type: 'list', list: ['x'] },
        action: 'hide',      },
      {
        id: 'c2',
        name: 'disabled custom',
        enabled: false,
        priority: 300,
        match: { type: 'list', list: ['y'] },
        action: 'hide',      },
    ];
    const result = resolveActiveRules(settingsWith({ enabledPresets: [], customRules: custom }));
    expect(result.map((r) => r.id)).toEqual(['c1']);
  });

  it('sorts by priority descending across presets and customs', () => {
    const custom: Rule[] = [
      {
        id: 'low',
        name: 'low',
        enabled: true,
        priority: 1,
        match: { type: 'list', list: [] },
        action: 'hide',      },
      {
        id: 'top',
        name: 'top',
        enabled: true,
        priority: 999,
        match: { type: 'list', list: [] },
        action: 'hide',      },
    ];
    const result = resolveActiveRules(
      settingsWith({ enabledPresets: ['hide-hex-codes'], customRules: custom }),
    );
    expect(result.map((r) => r.id)).toEqual(['top', 'hide-hex-codes', 'low']);
  });
});
