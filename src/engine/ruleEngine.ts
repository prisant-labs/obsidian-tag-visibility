/**
 * Core rule evaluation engine
 */

import {
  AttributedMatch,
  MatchCriteria,
  MatchResult,
  Rule,
  RuleAttribution,
  TagMeta,
  TagOverride,
} from '../types';
import { TagMatcher } from './matchers';

/**
 * The single decoration decision for a resolved tag (null = shown). Consumed by
 * the observers, the tag table, and the status-bar count so all three agree.
 */
export type Decoration = 'hidden' | 'flagged' | 'marked';

/**
 * Build an AttributedMatch that represents a per-tag override (D-015) rather
 * than a rule. Carries the overrideReason discriminator so callers can tell the
 * effective reason is an always-show / always-hide pin, while still returning
 * the existing RuleAttribution shape every consumer already handles.
 */
function attributeOverride(value: TagOverride): AttributedMatch {
  const showing = value === 'show';
  return {
    ruleId: '__override__',
    ruleName: showing ? 'Always show' : 'Always hide',
    // An always-show pin keeps the tag visible (show-only semantics); an
    // always-hide pin hides it.
    action: showing ? 'show-only' : 'hide',
    priority: Number.POSITIVE_INFINITY,
    builtin: false,
    reason: showing ? 'pinned to always show' : 'pinned to always hide',
    overrideReason: showing ? 'always-show' : 'always-hide',
  };
}

function describeReason(criteria: MatchCriteria, tagMeta: TagMeta | undefined): string {
  switch (criteria.type) {
    case 'regex':
      return `matches /${criteria.pattern ?? ''}/`;
    case 'frequency': {
      const op = criteria.operator ?? '=';
      const threshold = criteria.value ?? 0;
      const count = tagMeta?.count ?? 0;
      return `count ${count} ${op} ${threshold}`;
    }
    case 'list':
      return 'exact match in list';
    default:
      return 'matched';
  }
}

function attribute(rule: Rule, tagMeta: TagMeta | undefined): AttributedMatch {
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    action: rule.action,
    priority: rule.priority,
    builtin: rule.builtin ?? false,
    reason: describeReason(rule.match, tagMeta),
  };
}

export class RuleEngine {
  /**
   * Evaluate enabled rules against a tag and return the winning match.
   * Rules are evaluated in priority order (highest first); the highest-priority
   * matching rule wins. Returns null when nothing matches.
   */
  static evaluateTag(
    tag: string,
    tagMeta: TagMeta | undefined,
    rules: Rule[]
  ): MatchResult | null {
    const sortedRules = [...rules]
      .filter(r => r.enabled)
      .sort((a, b) => b.priority - a.priority);

    for (const rule of sortedRules) {
      if (TagMatcher.matches(tag, tagMeta, rule.match)) {
        return {
          matched: true,
          ruleId: rule.id,
          ruleName: rule.name,
        };
      }
    }

    return null;
  }

  /**
   * Get all rules that would match a tag
   */
  static getAllMatches(
    tag: string,
    tagMeta: TagMeta | undefined,
    rules: Rule[]
  ): MatchResult[] {
    const matches: MatchResult[] = [];

    for (const rule of rules.filter(r => r.enabled)) {
      if (TagMatcher.matches(tag, tagMeta, rule.match)) {
        matches.push({
          matched: true,
          ruleId: rule.id,
          ruleName: rule.name,
        });
      }
    }

    return matches;
  }

  /**
   * Test a tag string against a rule without needing full metadata
   */
  static testTag(tag: string, rule: Rule): boolean {
    return TagMatcher.matches(tag, undefined, rule.match);
  }

  /**
   * Diagnostic helper for "why is this tag affected?" UIs.
   * Returns the winning rule (highest-priority match) plus the full chain of
   * matching enabled rules, ordered priority-descending, with human-readable
   * reasons.
   */
  static getRuleAttribution(
    tag: string,
    tagMeta: TagMeta | undefined,
    rules: Rule[],
  ): RuleAttribution {
    const sortedRules = [...rules]
      .filter((r) => r.enabled)
      .sort((a, b) => b.priority - a.priority);

    const allMatches: AttributedMatch[] = [];
    for (const rule of sortedRules) {
      if (TagMatcher.matches(tag, tagMeta, rule.match)) {
        allMatches.push(attribute(rule, tagMeta));
      }
    }

    const effective = allMatches.length > 0 ? allMatches[0] : null;
    return { tag, effective, allMatches };
  }

  /**
   * Resolve a tag's visibility with overrides taking precedence over rules
   * (D-015). Precedence:
   *   1. overrides[tag] === 'show' -> always shown (safety net; beats every rule)
   *   2. overrides[tag] === 'hide' -> always hidden (beats every rule except an
   *      always-show on the same tag, which cannot co-occur)
   *   3. otherwise fall through to getRuleAttribution (rules + presets)
   *
   * Returns a RuleAttribution so TagListModel and ObserverBase consume one shape.
   * When an override applies, the effective match carries an overrideReason and
   * is the sole entry in allMatches: the override is THE effective reason, so it
   * supersedes (does not merely outrank) any matching rule.
   */
  static resolveVisibility(
    tag: string,
    tagMeta: TagMeta | undefined,
    rules: Rule[],
    overrides: Record<string, TagOverride>,
  ): RuleAttribution {
    // Own-property guard: a vault tag literally named `constructor`/`toString`
    // etc. must not resolve an inherited Object.prototype member as a phantom
    // always-hide override (DA-08).
    const override = Object.hasOwn(overrides, tag) ? overrides[tag] : undefined;
    if (override) {
      const effective = attributeOverride(override);
      return { tag, effective, allMatches: [effective] };
    }
    return RuleEngine.getRuleAttribution(tag, tagMeta, rules);
  }

  /**
   * Central predicate: returns true when a tag is effectively curated (hidden
   * or flagged in preview mode). A tag is curated when its effective
   * resolveVisibility match is non-null AND is not an always-show override
   * (which keeps the tag visible as the safety net and beats every rule).
   *
   * This is the single source of truth used by countByIntent, resolveDecoration,
   * TagListModel, and ObserverBase. Centralizing here ensures every surface stays
   * in sync without duplicating the condition.
   */
  static isEffectivelyHidden(effective: AttributedMatch | null): boolean {
    return effective !== null && effective.overrideReason !== 'always-show';
  }

  /**
   * The single hidden/flagged/marked decision for a resolved tag; null = shown.
   * - not effectively hidden (no match, or an always-show override) -> null
   * - action 'flag' -> 'marked' (persistent, preview-independent)
   * - otherwise (hide; deferred show-only / group degrade here) ->
   *   'flagged' in preview mode, 'hidden' normally
   *
   * This is the one place the flag action lives: it replaces the duplicated
   * `isEffectivelyHidden(...) ? (previewMode ? 'flagged' : 'hidden')` branch that
   * ObserverBase, TagListModel, and the status-bar count each carried.
   */
  static resolveDecoration(
    effective: AttributedMatch | null,
    previewMode: boolean,
  ): Decoration | null {
    if (!RuleEngine.isEffectivelyHidden(effective)) return null;
    if (effective!.action === 'flag') return 'marked';
    return previewMode ? 'flagged' : 'hidden';
  }

  /**
   * Split the curated tags by intent over a metadata map: how many a hide-type
   * action would hide vs how many a flag action marks. Scope- and preview-
   * independent - the buckets are intrinsic to rules + overrides; preview only
   * changes how each tag is painted, never which bucket it lands in. A tag counts
   * when isEffectivelyHidden is true for its resolveVisibility result; a flag-
   * action effective match counts as flag, everything else (hide, always-hide,
   * and the deferred show-only / group actions that degrade to hide) as hide.
   * Pure: no DOM, no dependence on which surfaces are toggled on.
   */
  static countByIntent(
    meta: Map<string, TagMeta>,
    rules: Rule[],
    overrides: Record<string, TagOverride>,
  ): { hide: number; flag: number } {
    let hide = 0;
    let flag = 0;
    for (const tagMeta of meta.values()) {
      const { effective } = RuleEngine.resolveVisibility(
        tagMeta.tag,
        tagMeta,
        rules,
        overrides,
      );
      if (!RuleEngine.isEffectivelyHidden(effective)) continue;
      if (effective!.action === 'flag') flag += 1;
      else hide += 1;
    }
    return { hide, flag };
  }
}
