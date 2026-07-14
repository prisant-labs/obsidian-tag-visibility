import { describe, expect, it } from 'vitest';
import { overrideMenuSpecs } from '../src/ui/curationWorkspace/rowMenu';
import { TagOverride } from '../src/types';

describe('overrideMenuSpecs (#1b: Clear override only when an override exists)', () => {
  it('offers only Always show / Always hide when the tag has no override', () => {
    const specs = overrideMenuSpecs('foo', {});
    expect(specs.map((s) => s.intent)).toEqual(['show', 'hide']);
  });

  it('adds Clear override when the tag has an always-show override', () => {
    const overrides: Record<string, TagOverride> = { foo: 'show' };
    const specs = overrideMenuSpecs('foo', overrides);
    expect(specs.map((s) => s.intent)).toEqual(['show', 'hide', 'clear']);
  });

  it('adds Clear override when the tag has an always-hide override', () => {
    const overrides: Record<string, TagOverride> = { foo: 'hide' };
    const specs = overrideMenuSpecs('foo', overrides);
    expect(specs.map((s) => s.intent)).toEqual(['show', 'hide', 'clear']);
  });

  it('keys off the specific tag, not any override present elsewhere', () => {
    const overrides: Record<string, TagOverride> = { other: 'hide' };
    const specs = overrideMenuSpecs('foo', overrides);
    expect(specs.map((s) => s.intent)).toEqual(['show', 'hide']);
  });
});
