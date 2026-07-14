import { describe, expect, it, vi } from 'vitest';
import { TagActions, TagActionsHost } from '../src/ui/tagList/tagActions';

function host(overrides: Partial<TagActionsHost> = {}): TagActionsHost {
  return {
    isPluginEnabled: () => true,
    getPluginInstance: () => null,
    setOverride: () => {},
    setReviewedBulk: () => {},
    ...overrides,
  };
}

/** A stand-in for Tag Wrangler's plugin instance; `rename` is its real method. */
function tagWrangler(renamed: string[]): { rename: (tag: string) => void } {
  return { rename: (tag: string) => void renamed.push(tag) };
}

/**
 * DA-26. The old sendToTagWrangler() fired executeCommandById('tag-wrangler:rename-tag')
 * once per tag and never read tags[i]. Tag Wrangler registers NO commands, so the id
 * did not exist; and executeCommandById takes no arguments, so the tag could not have
 * been passed even if it had. The feature never worked.
 *
 * The test that used to live here asserted the command id fired three times and passed,
 * because it was written against the same misunderstanding. These tests assert the only
 * thing that actually matters: does the TAG reach Tag Wrangler.
 */
describe('TagActions.renameWithTagWrangler (DA-26)', () => {
  it('passes the tag name to Tag Wrangler.rename', () => {
    const renamed: string[] = [];
    const actions = new TagActions(
      host({ getPluginInstance: () => tagWrangler(renamed) }),
    );
    expect(actions.renameWithTagWrangler('project/atlas')).toBe(true);
    expect(renamed).toEqual(['project/atlas']);
  });

  it('passes the bare name, with no leading hash (matches Tag Wrangler and our keys)', () => {
    const renamed: string[] = [];
    const actions = new TagActions(
      host({ getPluginInstance: () => tagWrangler(renamed) }),
    );
    actions.renameWithTagWrangler('status/done');
    expect(renamed[0].startsWith('#')).toBe(false);
  });

  it('does nothing when Tag Wrangler is not enabled', () => {
    const renamed: string[] = [];
    const actions = new TagActions(
      host({
        isPluginEnabled: () => false,
        getPluginInstance: () => tagWrangler(renamed),
      }),
    );
    expect(actions.renameWithTagWrangler('a')).toBe(false);
    expect(renamed).toEqual([]);
  });

  it('degrades to false if Tag Wrangler drops rename() (API drift), never throws', () => {
    const actions = new TagActions(
      host({ getPluginInstance: () => ({}) }), // instance present, no rename method
    );
    expect(actions.renameWithTagWrangler('a')).toBe(false);
  });

  it('degrades to false if rename() throws synchronously, never propagates', () => {
    const actions = new TagActions(
      host({
        getPluginInstance: () => ({
          rename: () => {
            throw new Error('tag wrangler exploded');
          },
        }),
      }),
    );
    expect(actions.renameWithTagWrangler('a')).toBe(false);
  });

  // Tag Wrangler's rename() is async. It currently catches its own errors, so it
  // does not reject today - but we duck-type the API precisely so we never depend
  // on its internals. A rejecting rename must not become an unhandled rejection,
  // and it must not fail silently either. (Raised by an adversarial review.)
  it('reports an async rename failure instead of swallowing it', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failures: unknown[] = [];
    const actions = new TagActions(
      host({
        getPluginInstance: () => ({
          rename: () => Promise.reject(new Error('rename blew up later')),
        }),
      }),
    );

    // The hand-off itself succeeded: we called rename and it did not throw.
    expect(actions.renameWithTagWrangler('a', (e) => void failures.push(e))).toBe(true);

    await new Promise((r) => setTimeout(r, 0)); // let the rejection settle

    expect(failures).toHaveLength(1); // the caller was told, so the UI can speak
    expect(errors).toHaveBeenCalled(); // and it was logged
    errors.mockRestore();
  });

  it('does NOT await the rename, so a slow modal never blocks the caller', () => {
    // rename() opens a modal: its promise settles when the USER finishes or
    // cancels. Awaiting it would make a cancelled rename look like a failed
    // hand-off. renameWithTagWrangler must return synchronously, before the
    // promise settles.
    let settle: (() => void) | null = null;
    const actions = new TagActions(
      host({
        getPluginInstance: () => ({
          rename: () => new Promise<void>((res) => { settle = res; }),
        }),
      }),
    );
    expect(actions.renameWithTagWrangler('a')).toBe(true);
    expect(settle).not.toBeNull(); // still pending, and we already returned
    settle?.();
  });
});

describe('TagActions visibility and bulk', () => {
  it('setVisibility hide pins each tag to hide via the override store', async () => {
    const calls: Array<[string, string | null]> = [];
    const actions = new TagActions(
      host({ setOverride: (tag, value) => void calls.push([tag, value]) }),
    );
    expect(await actions.setVisibility(['a'], 'hide')).toEqual({ applied: 1, deferred: 0 });
    expect(calls).toEqual([['a', 'hide']]);
  });

  it('setVisibility show pins each tag to show via the override store', async () => {
    const calls: Array<[string, string | null]> = [];
    const actions = new TagActions(
      host({ setOverride: (tag, value) => void calls.push([tag, value]) }),
    );
    expect(await actions.setVisibility(['a'], 'show')).toEqual({ applied: 1, deferred: 0 });
    expect(calls).toEqual([['a', 'show']]);
  });

  it('setVisibility clear removes the pin via the override store', async () => {
    const calls: Array<[string, string | null]> = [];
    const actions = new TagActions(
      host({ setOverride: (tag, value) => void calls.push([tag, value]) }),
    );
    expect(await actions.setVisibility(['a'], 'clear')).toEqual({ applied: 1, deferred: 0 });
    expect(calls).toEqual([['a', null]]);
  });

  it('setVisibility applies the override once per tag and counts every tag', async () => {
    const calls: Array<[string, string | null]> = [];
    const actions = new TagActions(
      host({ setOverride: (tag, value) => void calls.push([tag, value]) }),
    );
    expect(await actions.setVisibility(['a', 'b'], 'hide')).toEqual({ applied: 2, deferred: 0 });
    expect(calls).toEqual([
      ['a', 'hide'],
      ['b', 'hide'],
    ]);
  });

  it('applyBulk routes hide to a real hide override result', async () => {
    const calls: Array<[string, string | null]> = [];
    const actions = new TagActions(
      host({ setOverride: (tag, value) => void calls.push([tag, value]) }),
    );
    expect(await actions.applyBulk(['a'], 'hide')).toEqual({ applied: 1, deferred: 0 });
    expect(calls).toEqual([['a', 'hide']]);
  });

  it('applyBulk routes unhide to a show override result', async () => {
    const calls: Array<[string, string | null]> = [];
    const actions = new TagActions(
      host({ setOverride: (tag, value) => void calls.push([tag, value]) }),
    );
    expect(await actions.applyBulk(['a'], 'unhide')).toEqual({ applied: 1, deferred: 0 });
    expect(calls).toEqual([['a', 'show']]);
  });
});

describe('TagActions markReviewed', () => {
  it('markReviewed calls setReviewedBulk once with the full array and returns applied count', async () => {
    const calls: Array<[string[], boolean]> = [];
    const actions = new TagActions(
      host({ setReviewedBulk: (tags, value) => void calls.push([tags, value]) }),
    );
    expect(await actions.markReviewed(['a', 'b'], true)).toEqual({ applied: 2, deferred: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([['a', 'b'], true]);
  });

  it('markReviewed with false calls setReviewedBulk once with false', async () => {
    const calls: Array<[string[], boolean]> = [];
    const actions = new TagActions(
      host({ setReviewedBulk: (tags, value) => void calls.push([tags, value]) }),
    );
    expect(await actions.markReviewed(['a'], false)).toEqual({ applied: 1, deferred: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([['a'], false]);
  });

  it('applyBulk routes mark-reviewed to setReviewedBulk with true in one call', async () => {
    const calls: Array<[string[], boolean]> = [];
    const actions = new TagActions(
      host({ setReviewedBulk: (tags, value) => void calls.push([tags, value]) }),
    );
    expect(await actions.applyBulk(['a', 'b'], 'mark-reviewed')).toEqual({ applied: 2, deferred: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([['a', 'b'], true]);
  });

  it('applyBulk routes mark-unreviewed to setReviewedBulk with false in one call', async () => {
    const calls: Array<[string[], boolean]> = [];
    const actions = new TagActions(
      host({ setReviewedBulk: (tags, value) => void calls.push([tags, value]) }),
    );
    expect(await actions.applyBulk(['a'], 'mark-unreviewed')).toEqual({ applied: 1, deferred: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([['a'], false]);
  });
});
