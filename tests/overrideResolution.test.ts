import { describe, expect, it } from 'vitest';
import { RuleEngine } from '../src/engine/ruleEngine';
import { Rule, TagOverride } from '../src/types';

function hideRule(tag: string, overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'h-' + tag,
    name: 'hide ' + tag,
    enabled: true,
    priority: 50,
    match: { type: 'list', list: [tag] },
    action: 'hide',    ...overrides,
  };
}

describe('RuleEngine.resolveVisibility - override precedence (D-015)', () => {
  it('always-show wins over a matching hide rule (tag stays visible)', () => {
    const overrides: Record<string, TagOverride> = { t: 'show' };
    const result = RuleEngine.resolveVisibility('t', undefined, [hideRule('t')], overrides);
    // No effective hide: an always-show override makes the tag visible.
    expect(result.effective?.overrideReason).toBe('always-show');
    expect(result.effective?.action).toBe('show-only');
  });

  it('always-hide with no rule hides the tag, attributed to the override', () => {
    const overrides: Record<string, TagOverride> = { t: 'hide' };
    const result = RuleEngine.resolveVisibility('t', undefined, [], overrides);
    expect(result.effective?.overrideReason).toBe('always-hide');
    expect(result.effective?.action).toBe('hide');
  });

  it('always-hide AND a matching hide rule: effective reason is the OVERRIDE, not the rule', () => {
    const overrides: Record<string, TagOverride> = { t: 'hide' };
    const result = RuleEngine.resolveVisibility('t', undefined, [hideRule('t')], overrides);
    expect(result.effective?.overrideReason).toBe('always-hide');
    // The override is the effective reason - not the rule id.
    expect(result.effective?.ruleId).not.toBe('h-t');
  });

  it('no override falls through to existing rule attribution unchanged', () => {
    const rules: Rule[] = [hideRule('t', { id: 'rule-x', name: 'rule x' })];
    const withOverride = RuleEngine.resolveVisibility('t', undefined, rules, {});
    const plain = RuleEngine.getRuleAttribution('t', undefined, rules);
    expect(withOverride).toEqual(plain);
    expect(withOverride.effective?.ruleId).toBe('rule-x');
    expect(withOverride.effective?.overrideReason).toBeUndefined();
  });

  it('no override and no matching rule yields a shown (empty) attribution', () => {
    const result = RuleEngine.resolveVisibility('miss', undefined, [hideRule('other')], {});
    expect(result.effective).toBeNull();
  });

  it('a tag named like an Object.prototype member is not a phantom override (DA-08)', () => {
    for (const tag of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
      const result = RuleEngine.resolveVisibility(tag, undefined, [], {});
      expect(result.effective).toBeNull();
    }
  });

  it('an explicit override on a prototype-named tag still applies (DA-08)', () => {
    const overrides: Record<string, TagOverride> = {};
    overrides['constructor'] = 'hide';
    const result = RuleEngine.resolveVisibility('constructor', undefined, [], overrides);
    expect(result.effective?.overrideReason).toBe('always-hide');
  });
});
