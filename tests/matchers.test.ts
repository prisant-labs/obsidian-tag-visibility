import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TagMatcher } from '../src/engine/matchers';
import { MatchCriteria, TagMeta } from '../src/types';

const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
beforeAll(() => warnSpy.mockClear());
afterAll(() => warnSpy.mockRestore());

function meta(count: number): TagMeta {
  return {
    tag: 'sample',
    firstSeen: 0,
    lastSeen: 0,
    count,
    sources: ['inline'],
  };
}

describe('TagMatcher.matches - regex', () => {
  it('matches when pattern matches the tag', () => {
    const c: MatchCriteria = { type: 'regex', pattern: '^proj-' };
    expect(TagMatcher.matches('proj-alpha', undefined, c)).toBe(true);
  });

  it('does not match when pattern does not match', () => {
    const c: MatchCriteria = { type: 'regex', pattern: '^proj-' };
    expect(TagMatcher.matches('alpha-proj', undefined, c)).toBe(false);
  });

  it('returns false on empty pattern', () => {
    const c: MatchCriteria = { type: 'regex', pattern: '' };
    expect(TagMatcher.matches('anything', undefined, c)).toBe(false);
  });

  it('returns false on invalid regex (does not throw)', () => {
    const c: MatchCriteria = { type: 'regex', pattern: '[bad' };
    expect(TagMatcher.matches('anything', undefined, c)).toBe(false);
  });

  it('returns false when iOS-unsafe pattern is given', () => {
    const c: MatchCriteria = { type: 'regex', pattern: '(?<=x)y' };
    expect(TagMatcher.matches('xy', undefined, c)).toBe(false);
  });
});

describe('TagMatcher.matches - frequency', () => {
  it('returns false when meta is missing', () => {
    const c: MatchCriteria = { type: 'frequency', operator: '<=', value: 1 };
    expect(TagMatcher.matches('orphan', undefined, c)).toBe(false);
  });

  it('handles each operator', () => {
    const m = meta(5);
    expect(TagMatcher.matches('t', m, { type: 'frequency', operator: '<', value: 6 })).toBe(true);
    expect(TagMatcher.matches('t', m, { type: 'frequency', operator: '<', value: 5 })).toBe(false);
    expect(TagMatcher.matches('t', m, { type: 'frequency', operator: '<=', value: 5 })).toBe(true);
    expect(TagMatcher.matches('t', m, { type: 'frequency', operator: '>', value: 4 })).toBe(true);
    expect(TagMatcher.matches('t', m, { type: 'frequency', operator: '>', value: 5 })).toBe(false);
    expect(TagMatcher.matches('t', m, { type: 'frequency', operator: '>=', value: 5 })).toBe(true);
    expect(TagMatcher.matches('t', m, { type: 'frequency', operator: '=', value: 5 })).toBe(true);
    expect(TagMatcher.matches('t', m, { type: 'frequency', operator: '=', value: 4 })).toBe(false);
  });

  it('returns false when operator is undefined', () => {
    const c = { type: 'frequency', value: 1 } as MatchCriteria;
    expect(TagMatcher.matches('t', meta(0), c)).toBe(false);
  });
});

describe('TagMatcher.matches - list', () => {
  it('matches an exact entry', () => {
    const c: MatchCriteria = { type: 'list', list: ['todo', 'wip', 'archive'] };
    expect(TagMatcher.matches('wip', undefined, c)).toBe(true);
  });

  it('does not match when entry is absent', () => {
    const c: MatchCriteria = { type: 'list', list: ['todo'] };
    expect(TagMatcher.matches('done', undefined, c)).toBe(false);
  });

  it('matches an entry that carries a leading # (hand-edited or synced data.json) (DA-12)', () => {
    const c: MatchCriteria = { type: 'list', list: ['#wip'] };
    expect(TagMatcher.matches('wip', undefined, c)).toBe(true);
    expect(TagMatcher.matches('#wip', undefined, c)).toBe(false);
  });

  it('treats missing list as empty', () => {
    const c = { type: 'list' } as MatchCriteria;
    expect(TagMatcher.matches('anything', undefined, c)).toBe(false);
  });

  it('is case-sensitive', () => {
    const c: MatchCriteria = { type: 'list', list: ['Todo'] };
    expect(TagMatcher.matches('todo', undefined, c)).toBe(false);
    expect(TagMatcher.matches('Todo', undefined, c)).toBe(true);
  });
});

describe('TagMatcher.matches - unknown type', () => {
  it('returns false for unknown match type', () => {
    const c = { type: 'mystery' } as unknown as MatchCriteria;
    expect(TagMatcher.matches('t', undefined, c)).toBe(false);
  });
});
