import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression guard for a CSS gap that shipped through rc.1-7: TagPaneObserver
 * decorates `.tag-pane-tag` rows with `.tag-curator-hidden` (and
 * `.tag-curator-flagged` in preview mode), but styles.css carried hide rules
 * only for the NN, Properties, and Autocomplete scopes. The core tag-pane
 * class was inert, so the primary scope never hid on any platform. These rules
 * must exist or the tag pane silently no-ops.
 */
const css = readFileSync(resolve(process.cwd(), 'styles.css'), 'utf8');

describe('core tag-pane scope CSS', () => {
  it('collapses rows decorated with .tag-curator-hidden', () => {
    expect(css).toMatch(
      /\.tag-pane-tag\.tag-curator-hidden\b[^{]*\{[^}]*display:\s*none/,
    );
  });

  it('has a flag style for .tag-curator-flagged rows', () => {
    expect(css).toMatch(/\.tag-pane-tag\.tag-curator-flagged\b/);
  });
});

/**
 * NN scope ships Approach A (decided 2026-07-01): NN's committed-offset
 * virtualizer reserves every row's slot forever, so display:none leaves
 * permanent gap bands. Hidden NN rows are dimmed and struck through instead -
 * visible, interactive, clearly suppressed.
 */
describe('Notebook Navigator scope CSS (dim + strikethrough)', () => {
  it('does not display:none NN hidden rows (the slot cannot be reclaimed)', () => {
    expect(css).not.toMatch(
      /\.nn-tag\.tc-nn-hidden\b[^{]*\{[^}]*display:\s*none/,
    );
  });

  it('dims the hidden row in place', () => {
    expect(css).toMatch(/\.nn-tag\.tc-nn-hidden\b[^{]*\{[^}]*opacity/);
  });

  it('strikes through the tag name only (count badge stays legible)', () => {
    expect(css).toMatch(
      /\.nn-tag\.tc-nn-hidden\s+\.nn-navitem-name\b[^{]*\{[^}]*line-through/,
    );
  });
});
