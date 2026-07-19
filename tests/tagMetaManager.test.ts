// @vitest-environment happy-dom
// (tagMeta.ts uses window.setTimeout / window.clearTimeout for popout-window
// compatibility per the directory review; the node environment has no window.)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CachedMetadata, Plugin, TFile } from 'obsidian';
import { TagMetaManager } from '../src/storage/tagMeta';

class FakeAdapter {
  files = new Map<string, string>();
  dirs = new Set<string>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path);
  }
  async read(path: string): Promise<string> {
    const f = this.files.get(path);
    if (f === undefined) throw new Error(`No such file: ${path}`);
    return f;
  }
  async write(path: string, data: string): Promise<void> {
    this.files.set(path, data);
  }
  async mkdir(path: string): Promise<void> {
    this.dirs.add(path);
  }
}

interface FakeApp {
  vault: {
    adapter: FakeAdapter;
    getMarkdownFiles: () => TFile[];
    markdownFiles: TFile[];
  };
  metadataCache: {
    caches: Map<string, CachedMetadata>;
    getFileCache: (file: TFile) => CachedMetadata | null;
  };
}

function makeApp(): FakeApp {
  const adapter = new FakeAdapter();
  const markdownFiles: TFile[] = [];
  const caches = new Map<string, CachedMetadata>();
  return {
    vault: {
      adapter,
      markdownFiles,
      getMarkdownFiles: () => markdownFiles,
    },
    metadataCache: {
      caches,
      getFileCache: (file: TFile) => caches.get(file.path) ?? null,
    },
  };
}

function makePlugin(): Plugin {
  const p = new Plugin();
  p.manifest = { id: 'tag-curator', dir: '.obsidian/plugins/tag-curator' };
  return p;
}

// A stand-in for the durable reviewed store (SettingsManager in production).
function fakeReviewedStore(
  initial: Record<string, true> = {},
  opts: { shouldLift?: boolean } = {},
) {
  const map: Record<string, true> = { ...initial };
  return {
    map,
    isReviewed: (tag: string) => map[tag] === true,
    setReviewedTags: (tags: string[], value: boolean) => {
      for (const t of tags) {
        if (value) map[t] = true;
        else delete map[t];
      }
    },
    // True only on the load that migrated this vault across the v10 boundary;
    // defaults true so the legacy-lift test exercises the lift.
    shouldLiftLegacyReviewed: () => opts.shouldLift ?? true,
  };
}

function addFile(app: FakeApp, path: string, tags: string[], frontmatterTags?: string[]): TFile {
  const file = new TFile(path);
  app.vault.markdownFiles.push(file);
  app.metadataCache.caches.set(path, {
    tags: tags.map((t) => ({ tag: t.startsWith('#') ? t : `#${t}` })),
    frontmatter: frontmatterTags ? { tags: frontmatterTags } : undefined,
  });
  return file;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TagMetaManager.scanAll + load', () => {
  it('flushes a populated tags.json after a scan', async () => {
    const app = makeApp();
    addFile(app, 'a.md', ['todo']);
    addFile(app, 'b.md', ['todo', 'wip']);

    const mgr = new TagMetaManager(app as never, makePlugin());
    await mgr.scanAll();

    const written = app.vault.adapter.files.get('.obsidian/plugins/tag-curator/tags.json');
    expect(written).toBeDefined();
    const parsed = JSON.parse(written!);
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.tags.todo.count).toBe(2);
    expect(parsed.tags.wip.count).toBe(1);
  });

  // B-05 (cold-cache sidecar wipe): getFileCache returns null both for "this file
  // is not indexed yet" and for "this file has no tags". A scan that runs before
  // Obsidian has populated the metadata cache therefore reads every file as
  // untagged, and the empty result used to be swapped in as authoritative and
  // flushed over a good tags.json. Observed live on a 17k-note vault: a 486 KB
  // sidecar was replaced with `{"tags":{}}`. The sidecar is the ONLY home for
  // user-authored descriptions and aliases, which are not rebuildable.
  it('B-05: a scan on a cold metadata cache does not wipe the store or the sidecar', async () => {
    const app = makeApp();
    const path = '.obsidian/plugins/tag-curator/tags.json';
    await app.vault.adapter.write(
      path,
      JSON.stringify({
        schemaVersion: 2,
        tags: {
          todo: {
            tag: 'todo',
            firstSeen: 1,
            lastSeen: 1,
            count: 2,
            sources: ['inline'],
            description: 'user-authored, not rebuildable',
          },
        },
      }),
    );

    // The vault HAS markdown files, but the metadata cache has no entry for any
    // of them: Obsidian is still indexing. addFile() is deliberately not used,
    // because it would also seed the cache.
    app.vault.markdownFiles.push(new TFile('a.md'), new TFile('b.md'));

    const mgr = new TagMetaManager(app as never, makePlugin());
    await mgr.load();
    expect(mgr.all().size).toBe(1);

    const scanned = await mgr.scanAll();

    // In-memory store survives.
    expect(mgr.all().size).toBe(1);
    // On-disk sidecar survives, including the user-authored field.
    const onDisk = JSON.parse(app.vault.adapter.files.get(path)!);
    expect(Object.keys(onDisk.tags)).toEqual(['todo']);
    expect(onDisk.tags.todo.description).toBe('user-authored, not rebuildable');
    // The scan reports that it deferred rather than that the vault is empty.
    expect(scanned).toBe(false);
  });

  // B-05 companion: the guard keys off cache availability, NOT off "the result is
  // empty", so a genuinely untagged vault (files present, cache warm, no tags)
  // still scans and still persists an empty store.
  it('B-05: a warm cache with genuinely untagged files still scans and persists', async () => {
    const app = makeApp();
    addFile(app, 'a.md', []);
    addFile(app, 'b.md', []);

    const mgr = new TagMetaManager(app as never, makePlugin());
    const scanned = await mgr.scanAll();

    expect(scanned).toBe(true);
    expect(mgr.all().size).toBe(0);
    const written = app.vault.adapter.files.get('.obsidian/plugins/tag-curator/tags.json');
    expect(JSON.parse(written!).tags).toEqual({});
  });

  // B-05 companion: an empty vault (no markdown files at all) is not a cold cache;
  // it must scan normally rather than deferring forever.
  it('B-05: an empty vault scans normally', async () => {
    const mgr = new TagMetaManager(makeApp() as never, makePlugin());
    expect(await mgr.scanAll()).toBe(true);
  });

  it('load reads a previously written tags.json', async () => {
    const app = makeApp();
    const plugin = makePlugin();
    addFile(app, 'a.md', ['done']);
    const writer = new TagMetaManager(app as never, plugin);
    await writer.scanAll();

    const reader = new TagMetaManager(app as never, plugin);
    await reader.load();
    expect(reader.get('done')?.count).toBe(1);
  });

  it('load returns empty store when tags.json does not exist', async () => {
    const mgr = new TagMetaManager(makeApp() as never, makePlugin());
    await mgr.load();
    expect(mgr.all().size).toBe(0);
  });

  it('load discards data with a wrong schemaVersion', async () => {
    const app = makeApp();
    await app.vault.adapter.write(
      '.obsidian/plugins/tag-curator/tags.json',
      JSON.stringify({ schemaVersion: 99, tags: { stale: { tag: 'stale', count: 5 } } }),
    );
    const mgr = new TagMetaManager(app as never, makePlugin());
    await mgr.load();
    expect(mgr.all().size).toBe(0);
  });

  it('load handles corrupted JSON without throwing', async () => {
    const app = makeApp();
    await app.vault.adapter.write(
      '.obsidian/plugins/tag-curator/tags.json',
      '{not json',
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mgr = new TagMetaManager(app as never, makePlugin());
    await mgr.load();
    expect(mgr.all().size).toBe(0);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('TagMetaManager.scanAll rebuild (P1-03)', () => {
  it('drops tags from a stale sidecar that no current file contains', async () => {
    const app = makeApp();
    const plugin = makePlugin();
    // Sidecar on disk carries a stale tag absent from every current file.
    await app.vault.adapter.write(
      '.obsidian/plugins/tag-curator/tags.json',
      JSON.stringify({
        schemaVersion: 1,
        tags: {
          obsolete: { tag: 'obsolete', firstSeen: 1, lastSeen: 1, count: 3, sources: ['inline'] },
          kept: { tag: 'kept', firstSeen: 1, lastSeen: 1, count: 1, sources: ['inline'] },
        },
      }),
    );
    addFile(app, 'a.md', ['kept']);

    const mgr = new TagMetaManager(app as never, plugin);
    await mgr.load();
    expect(mgr.get('obsolete')).toBeDefined();

    await mgr.scanAll();

    expect(mgr.get('obsolete')).toBeUndefined();
    expect(mgr.get('kept')?.count).toBe(1);
  });

  it('preserves user-owned fields and firstSeen for surviving tags across a rescan', async () => {
    const app = makeApp();
    const plugin = makePlugin();
    await app.vault.adapter.write(
      '.obsidian/plugins/tag-curator/tags.json',
      JSON.stringify({
        schemaVersion: 1,
        tags: {
          kept: {
            tag: 'kept',
            firstSeen: 111,
            lastSeen: 111,
            count: 1,
            sources: ['inline'],
            reviewed: true,
            description: 'my note',
            aliases: ['kept-alias'],
          },
        },
      }),
    );
    addFile(app, 'a.md', ['kept']);

    const mgr = new TagMetaManager(app as never, plugin);
    await mgr.load();
    await mgr.scanAll();

    const meta = mgr.get('kept');
    expect(meta?.reviewed).toBe(true);
    expect(meta?.firstSeen).toBe(111);
    expect(meta?.description).toBe('my note');
    expect(meta?.aliases).toEqual(['kept-alias']);
  });

  it('emits exactly one changed event for a full scan', async () => {
    const app = makeApp();
    addFile(app, 'a.md', ['x']);
    addFile(app, 'b.md', ['y', 'z']);
    const mgr = new TagMetaManager(app as never, makePlugin());
    let fired = 0;
    mgr.on('changed', () => {
      fired += 1;
    });

    await mgr.scanAll();
    expect(fired).toBe(1);
  });
});

describe('TagMetaManager.indexFile', () => {
  it('records first/last seen timestamps and sources', async () => {
    const app = makeApp();
    const file = addFile(app, 'a.md', ['todo'], ['from-fm']);
    const mgr = new TagMetaManager(app as never, makePlugin());

    mgr.indexFile(file);
    const todo = mgr.get('todo');
    const fromFm = mgr.get('from-fm');

    expect(todo?.count).toBe(1);
    expect(todo?.sources).toEqual(['inline']);
    expect(fromFm?.count).toBe(1);
    expect(fromFm?.sources).toEqual(['frontmatter']);
    expect(todo?.firstSeen).toBe(todo?.lastSeen);
  });

  it('updates lastSeen and merges sources on re-index', async () => {
    const app = makeApp();
    const file = addFile(app, 'a.md', ['todo']);
    const mgr = new TagMetaManager(app as never, makePlugin());

    mgr.indexFile(file);
    const firstSeen = mgr.get('todo')?.firstSeen;

    // simulate the file gaining a frontmatter source
    app.metadataCache.caches.set('a.md', {
      tags: [{ tag: '#todo' }],
      frontmatter: { tags: ['todo'] },
    });
    vi.advanceTimersByTime(10);
    mgr.indexFile(file);

    const meta = mgr.get('todo');
    expect(meta?.firstSeen).toBe(firstSeen);
    expect(meta?.lastSeen).toBeGreaterThan(firstSeen!);
    expect(meta?.sources).toContain('inline');
    expect(meta?.sources).toContain('frontmatter');
  });

  it('emits "changed" event', async () => {
    const app = makeApp();
    const file = addFile(app, 'a.md', ['todo']);
    const mgr = new TagMetaManager(app as never, makePlugin());
    let fired = 0;
    mgr.on('changed', () => {
      fired += 1;
    });
    mgr.indexFile(file);
    expect(fired).toBe(1);
  });

  it('recomputes count when a previous tag is gone from the file', async () => {
    const app = makeApp();
    const file = addFile(app, 'a.md', ['todo', 'wip']);
    const mgr = new TagMetaManager(app as never, makePlugin());
    mgr.indexFile(file);
    expect(mgr.get('wip')?.count).toBe(1);

    // file no longer contains wip
    app.metadataCache.caches.set('a.md', { tags: [{ tag: '#todo' }] });
    mgr.indexFile(file);

    expect(mgr.get('wip')).toBeUndefined();
    expect(mgr.get('todo')?.count).toBe(1);
  });
});

describe('TagMetaManager.removeFile', () => {
  it('drops tags that no other file contains', async () => {
    const app = makeApp();
    const file = addFile(app, 'a.md', ['solo']);
    const mgr = new TagMetaManager(app as never, makePlugin());
    mgr.indexFile(file);
    expect(mgr.get('solo')?.count).toBe(1);

    mgr.removeFile('a.md');
    expect(mgr.get('solo')).toBeUndefined();
  });

  it('decrements count for tags still present in other files', async () => {
    const app = makeApp();
    const a = addFile(app, 'a.md', ['shared']);
    const b = addFile(app, 'b.md', ['shared']);
    const mgr = new TagMetaManager(app as never, makePlugin());
    mgr.indexFile(a);
    mgr.indexFile(b);
    expect(mgr.get('shared')?.count).toBe(2);

    mgr.removeFile('a.md');
    expect(mgr.get('shared')?.count).toBe(1);
  });

  it('is a no-op for an unknown path', async () => {
    const app = makeApp();
    const file = addFile(app, 'a.md', ['todo']);
    const mgr = new TagMetaManager(app as never, makePlugin());
    mgr.indexFile(file);

    mgr.removeFile('never-indexed.md');
    expect(mgr.get('todo')?.count).toBe(1);
  });
});

describe('TagMetaManager.renameFile', () => {
  it('moves the per-file tag set to the new path', async () => {
    const app = makeApp();
    const file = addFile(app, 'old.md', ['todo']);
    const mgr = new TagMetaManager(app as never, makePlugin());
    mgr.indexFile(file);

    mgr.renameFile('old.md', 'new.md');
    // After rename, removing by the old path should not change counts
    mgr.removeFile('old.md');
    expect(mgr.get('todo')?.count).toBe(1);
    // And removing by the new path should drop the tag
    mgr.removeFile('new.md');
    expect(mgr.get('todo')).toBeUndefined();
  });

  it('is a no-op for an unknown path', async () => {
    const app = makeApp();
    const file = addFile(app, 'a.md', ['todo']);
    const mgr = new TagMetaManager(app as never, makePlugin());
    mgr.indexFile(file);

    mgr.renameFile('never.md', 'whatever.md');
    expect(mgr.get('todo')?.count).toBe(1);
  });
});

describe('TagMetaManager debounced persistence', () => {
  it('does not flush until the debounce interval elapses', async () => {
    const app = makeApp();
    const file = addFile(app, 'a.md', ['todo']);
    const mgr = new TagMetaManager(app as never, makePlugin());
    mgr.setDebounceMs(500);
    mgr.indexFile(file);

    expect(app.vault.adapter.files.has('.obsidian/plugins/tag-curator/tags.json')).toBe(false);

    await vi.advanceTimersByTimeAsync(500);
    expect(app.vault.adapter.files.has('.obsidian/plugins/tag-curator/tags.json')).toBe(true);
  });

  it('clamps debounce to a minimum of 500ms', async () => {
    const app = makeApp();
    const file = addFile(app, 'a.md', ['todo']);
    const mgr = new TagMetaManager(app as never, makePlugin());
    mgr.setDebounceMs(0); // should clamp to 500
    mgr.indexFile(file);

    await vi.advanceTimersByTimeAsync(499);
    expect(app.vault.adapter.files.has('.obsidian/plugins/tag-curator/tags.json')).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(app.vault.adapter.files.has('.obsidian/plugins/tag-curator/tags.json')).toBe(true);
  });

  it('coalesces rapid edits into a single flush', async () => {
    const app = makeApp();
    const a = addFile(app, 'a.md', ['todo']);
    const b = addFile(app, 'b.md', ['wip']);
    const mgr = new TagMetaManager(app as never, makePlugin());
    mgr.setDebounceMs(500);

    mgr.indexFile(a);
    await vi.advanceTimersByTimeAsync(100);
    mgr.indexFile(b);
    await vi.advanceTimersByTimeAsync(100);
    expect(app.vault.adapter.files.has('.obsidian/plugins/tag-curator/tags.json')).toBe(false);

    await vi.advanceTimersByTimeAsync(500);
    const parsed = JSON.parse(app.vault.adapter.files.get('.obsidian/plugins/tag-curator/tags.json')!);
    expect(Object.keys(parsed.tags).sort()).toEqual(['todo', 'wip']);
  });
});

describe('TagMetaManager.setReviewed', () => {
  it('sets reviewed to true and fires changed', () => {
    const app = makeApp();
    const file = addFile(app, 'a.md', ['inbox']);
    const mgr = new TagMetaManager(app as never, makePlugin());
    mgr.indexFile(file);

    let fired = 0;
    mgr.on('changed', () => {
      fired += 1;
    });

    mgr.setReviewed('inbox', true);
    expect(mgr.get('inbox')?.reviewed).toBe(true);
    expect(fired).toBe(1);
  });

  it('sets reviewed to false and fires changed', () => {
    const app = makeApp();
    const file = addFile(app, 'a.md', ['inbox']);
    const mgr = new TagMetaManager(app as never, makePlugin());
    mgr.indexFile(file);

    mgr.setReviewed('inbox', true);
    let fired = 0;
    mgr.on('changed', () => {
      fired += 1;
    });

    mgr.setReviewed('inbox', false);
    expect(mgr.get('inbox')?.reviewed).toBe(false);
    expect(fired).toBe(1);
  });

  it('is a no-op for a tag not in the store', () => {
    const app = makeApp();
    const mgr = new TagMetaManager(app as never, makePlugin());

    let fired = 0;
    mgr.on('changed', () => {
      fired += 1;
    });

    mgr.setReviewed('ghost', true);
    expect(mgr.get('ghost')).toBeUndefined();
    expect(fired).toBe(0);
  });
});

describe('TagMetaManager.setReviewedBulk', () => {
  it('marks multiple present tags and fires changed exactly once', () => {
    const app = makeApp();
    const a = addFile(app, 'a.md', ['alpha']);
    const b = addFile(app, 'b.md', ['beta']);
    const mgr = new TagMetaManager(app as never, makePlugin());
    mgr.indexFile(a);
    mgr.indexFile(b);

    let fired = 0;
    mgr.on('changed', () => {
      fired += 1;
    });

    mgr.setReviewedBulk(['alpha', 'beta'], true);
    expect(mgr.get('alpha')?.reviewed).toBe(true);
    expect(mgr.get('beta')?.reviewed).toBe(true);
    expect(fired).toBe(1);
  });

  it('fires zero changed events when all tags are absent', () => {
    const app = makeApp();
    const mgr = new TagMetaManager(app as never, makePlugin());

    let fired = 0;
    mgr.on('changed', () => {
      fired += 1;
    });

    mgr.setReviewedBulk(['ghost', 'phantom'], true);
    expect(fired).toBe(0);
  });

  it('fires zero changed events when all tags are already at the target value', () => {
    const app = makeApp();
    const file = addFile(app, 'a.md', ['alpha']);
    const mgr = new TagMetaManager(app as never, makePlugin());
    mgr.indexFile(file);
    mgr.setReviewedBulk(['alpha'], true);

    let fired = 0;
    mgr.on('changed', () => {
      fired += 1;
    });

    mgr.setReviewedBulk(['alpha'], true);
    expect(fired).toBe(0);
  });

  it('skips absent tags and still marks and fires for present ones', () => {
    const app = makeApp();
    const file = addFile(app, 'a.md', ['real']);
    const mgr = new TagMetaManager(app as never, makePlugin());
    mgr.indexFile(file);

    let fired = 0;
    mgr.on('changed', () => {
      fired += 1;
    });

    mgr.setReviewedBulk(['real', 'ghost'], true);
    expect(mgr.get('real')?.reviewed).toBe(true);
    expect(mgr.get('ghost')).toBeUndefined();
    expect(fired).toBe(1);
  });
});

describe('TagMetaManager.unload', () => {
  it('flushes pending changes synchronously and clears the timer', async () => {
    const app = makeApp();
    const file = addFile(app, 'a.md', ['todo']);
    const mgr = new TagMetaManager(app as never, makePlugin());
    mgr.setDebounceMs(5000);
    mgr.indexFile(file);

    mgr.unload();
    // unload kicks off flushNow which is async; let microtasks run
    await Promise.resolve();
    await Promise.resolve();
    expect(app.vault.adapter.files.has('.obsidian/plugins/tag-curator/tags.json')).toBe(true);
  });
});

describe('TagMetaManager reviewed durability (P2-09)', () => {
  it('setReviewedBulk writes through to the durable reviewed store', () => {
    const app = makeApp();
    const file = addFile(app, 'a.md', ['inbox']);
    const store = fakeReviewedStore();
    const mgr = new TagMetaManager(app as never, makePlugin(), store as never);
    mgr.indexFile(file);

    mgr.setReviewedBulk(['inbox'], true);
    expect(store.isReviewed('inbox')).toBe(true);
    expect(mgr.get('inbox')?.reviewed).toBe(true);

    mgr.setReviewedBulk(['inbox'], false);
    expect(store.isReviewed('inbox')).toBe(false);
  });

  it('lifts legacy reviewed flags from a v1 sidecar into the durable store on load', async () => {
    const app = makeApp();
    const plugin = makePlugin();
    // A pre-migration (v1) sidecar carried reviewed inline.
    await app.vault.adapter.write(
      '.obsidian/plugins/tag-curator/tags.json',
      JSON.stringify({
        schemaVersion: 1,
        tags: {
          done: {
            tag: 'done',
            firstSeen: 1,
            lastSeen: 1,
            count: 1,
            sources: ['inline'],
            reviewed: true,
          },
          todo: { tag: 'todo', firstSeen: 1, lastSeen: 1, count: 1, sources: ['inline'] },
        },
      }),
    );
    const store = fakeReviewedStore();
    const mgr = new TagMetaManager(app as never, plugin, store as never);
    await mgr.load();

    // Lifted to the durable store...
    expect(store.isReviewed('done')).toBe(true);
    expect(store.isReviewed('todo')).toBe(false);
    // ...and the in-memory mirror reflects it.
    expect(mgr.get('done')?.reviewed).toBe(true);
  });

  it('hydrates meta.reviewed from the durable store (settings is authoritative)', async () => {
    const app = makeApp();
    const plugin = makePlugin();
    // A v2 sidecar no longer stores reviewed; the durable store does.
    await app.vault.adapter.write(
      '.obsidian/plugins/tag-curator/tags.json',
      JSON.stringify({
        schemaVersion: 2,
        tags: { done: { tag: 'done', firstSeen: 1, lastSeen: 1, count: 1, sources: ['inline'] } },
      }),
    );
    const store = fakeReviewedStore({ done: true });
    const mgr = new TagMetaManager(app as never, plugin, store as never);
    await mgr.load();
    expect(mgr.get('done')?.reviewed).toBe(true);
  });

  it('writes the v2 sidecar without the reviewed field', async () => {
    const app = makeApp();
    addFile(app, 'a.md', ['inbox']);
    const store = fakeReviewedStore();
    const mgr = new TagMetaManager(app as never, makePlugin(), store as never);
    await mgr.scanAll();
    mgr.setReviewedBulk(['inbox'], true);
    mgr.unload();
    await Promise.resolve();
    await Promise.resolve();

    const written = JSON.parse(
      app.vault.adapter.files.get('.obsidian/plugins/tag-curator/tags.json')!,
    );
    expect(written.schemaVersion).toBe(2);
    expect(written.tags.inbox).toBeDefined();
    expect(written.tags.inbox.reviewed).toBeUndefined();
  });

  it('hydrates reviewed for a tag re-entering via indexFile (delete-then-recreate)', () => {
    const app = makeApp();
    // Durable store says #done is reviewed, but it is absent from the in-memory
    // store (every note carrying it was deleted, dropping it to count 0).
    const store = fakeReviewedStore({ done: true });
    const mgr = new TagMetaManager(app as never, makePlugin(), store as never);
    const file = addFile(app, 'new.md', ['done']);

    mgr.indexFile(file); // re-enters via the incremental path, not load/scanAll

    expect(mgr.get('done')?.reviewed).toBe(true);
  });

  it('does not re-lift a reappearing v1 sidecar after migration (preserves un-reviews)', async () => {
    const app = makeApp();
    const plugin = makePlugin();
    // A v1 sidecar reappears (e.g. synced from a device still on the old plugin)
    // marking #inbox reviewed - but the user already un-reviewed it (durable empty)
    // and settings has migrated past v10, so shouldLift is false.
    await app.vault.adapter.write(
      '.obsidian/plugins/tag-curator/tags.json',
      JSON.stringify({
        schemaVersion: 1,
        tags: {
          inbox: {
            tag: 'inbox',
            firstSeen: 1,
            lastSeen: 1,
            count: 1,
            sources: ['inline'],
            reviewed: true,
          },
        },
      }),
    );
    const store = fakeReviewedStore({}, { shouldLift: false });
    const mgr = new TagMetaManager(app as never, plugin, store as never);
    await mgr.load();

    // The un-review survives: the reappearing v1 sidecar did not re-lift inbox.
    expect(store.isReviewed('inbox')).toBe(false);
    expect(mgr.get('inbox')?.reviewed).toBe(false);
  });
});
