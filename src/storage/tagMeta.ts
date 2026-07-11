import { App, Events, Plugin, TFile, normalizePath } from 'obsidian';
import { TagMeta, TagSource } from '../types';
import { tagsFromCache } from '../util/tagUtils';

interface PersistedTagMeta {
  schemaVersion: number;
  tags: Record<string, TagMeta>;
}

/**
 * Durable store for user-owned reviewed state (SettingsManager in production).
 * `reviewed` is NOT derivable from the vault, so it must not live in the
 * rebuildable tags.json sidecar; TagMetaManager keeps a `meta.reviewed` mirror for
 * the read path but treats this store as the source of truth (P2-09).
 */
export interface ReviewedStore {
  isReviewed(tag: string): boolean;
  setReviewedTags(tags: string[], value: boolean): void | Promise<void>;
  // True only on the load that migrated this vault across the v10 boundary, where
  // reviewed moved into durable settings. Gates the one-time legacy lift below.
  shouldLiftLegacyReviewed(): boolean;
}

// v2: reviewed is no longer written into the sidecar (it lives in durable settings
// now). A v1 sidecar is still accepted on load so its inline reviewed flags can be
// lifted into the durable store once.
const SCHEMA = 2;

export class TagMetaManager extends Events {
  private app: App;
  private plugin: Plugin;
  private reviewed?: ReviewedStore;
  private store = new Map<string, TagMeta>();
  private fileTags = new Map<string, Set<string>>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceMs = 5000;

  constructor(app: App, plugin: Plugin, reviewed?: ReviewedStore) {
    super();
    this.app = app;
    this.plugin = plugin;
    this.reviewed = reviewed;
  }

  setDebounceMs(ms: number): void {
    this.debounceMs = Math.max(500, ms);
  }

  private filePath(): string {
    const dir = this.plugin.manifest.dir ?? `.obsidian/plugins/${this.plugin.manifest.id}`;
    return normalizePath(`${dir}/tags.json`);
  }

  async load(): Promise<void> {
    const path = this.filePath();
    const adapter = this.app.vault.adapter;
    try {
      if (!(await adapter.exists(path))) {
        this.store = new Map();
        return;
      }
      const raw = await adapter.read(path);
      const parsed = JSON.parse(raw) as PersistedTagMeta;
      // Accept the current schema and the immediately-prior v1 (which stored
      // reviewed inline). Any other version is discarded; the derived data
      // rebuilds on the next scanAll.
      if (parsed.schemaVersion !== SCHEMA && parsed.schemaVersion !== 1) {
        this.store = new Map();
        return;
      }
      this.store = new Map(Object.entries(parsed.tags ?? {}));
      // One-time lift of a v1 sidecar's inline reviewed flags into durable
      // settings - but ONLY on the load that migrated the vault across the v10
      // boundary (shouldLiftLegacyReviewed). A v1 sidecar that reappears later
      // (synced from a device still on the old plugin, or a backup restore) on an
      // already-migrated vault must not re-lift: that would overwrite tags the
      // user has since un-reviewed.
      if (parsed.schemaVersion === 1 && this.reviewed?.shouldLiftLegacyReviewed()) {
        await this.liftLegacyReviewed();
      }
      // Durable settings is authoritative for reviewed; mirror it onto the store.
      this.hydrateReviewed();
    } catch (e) {
      console.error('[tag-visibility] tags.json corrupted, rebuilding', e);
      this.store = new Map();
    }
  }

  /**
   * Full reindex: rebuild a fresh aggregate from the CURRENT vault, then swap it
   * in. Unlike the incremental `indexFile` path, this rebuilds from nothing, so
   * tags persisted in `tags.json` but no longer present in any file are dropped.
   * The incremental path cannot see those: it only reconciles a file's own
   * previous-vs-current tags, and after a fresh `load()` the `fileTags` map is
   * empty, so a stale sidecar tag is in no file's previous set and never
   * recomputed to zero. Durable user-owned fields (`firstSeen`, `description`,
   * `aliases`, `reviewed`) are carried over for surviving tags; `count`,
   * `sources`, and `lastSeen` are recomputed from current state. Fires a single
   * `changed` after the swap (not one per file).
   */
  async scanAll(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    const previousStore = this.store;
    const freshStore = new Map<string, TagMeta>();
    const freshFileTags = new Map<string, Set<string>>();
    const now = Date.now();

    for (const file of files) {
      const { currentTags, sourcesByTag } = this.readFileTags(file);
      freshFileTags.set(file.path, currentTags);
      for (const tag of currentTags) {
        const sources = sourcesByTag.get(tag) ?? ['frontmatter'];
        const existing = freshStore.get(tag);
        if (existing) {
          existing.count += 1;
          for (const source of sources) {
            if (!existing.sources.includes(source)) existing.sources.push(source);
          }
        } else {
          const prior = previousStore.get(tag);
          const meta: TagMeta = {
            tag,
            firstSeen: prior?.firstSeen ?? now,
            lastSeen: now,
            count: 1,
            sources: [...sources],
          };
          // Carry user-owned fields forward; never reset them on a reindex.
          if (prior?.description !== undefined) meta.description = prior.description;
          if (prior?.aliases !== undefined) meta.aliases = prior.aliases;
          if (prior?.reviewed !== undefined) meta.reviewed = prior.reviewed;
          freshStore.set(tag, meta);
        }
      }
    }

    this.store = freshStore;
    this.fileTags = freshFileTags;
    // Durable settings is authoritative for reviewed; mirror it onto the rebuilt
    // store (the prior carry-over above covers the no-store case in tests).
    this.hydrateReviewed();
    await this.flushNow();
    this.trigger('changed');
  }

  /**
   * Read a file's tags from the metadata cache: the file's tag set plus each
   * tag's source locations (inline body, frontmatter, or both). Shared by the
   * incremental `indexFile` path and the bulk `scanAll` rebuild so both read the
   * cache identically. Tag keys carry no leading '#'.
   */
  private readFileTags(file: TFile): {
    currentTags: Set<string>;
    sourcesByTag: Map<string, TagSource[]>;
  } {
    const cache = this.app.metadataCache.getFileCache(file);
    const inlineTags = (cache?.tags ?? []).map((t) => t.tag);
    const allTags = tagsFromCache(cache);
    const inlineSet = new Set(inlineTags.map((t) => (t.startsWith('#') ? t.slice(1) : t)));
    const fm = cache?.frontmatter?.tags;
    const frontmatterSet = new Set<string>();
    if (typeof fm === 'string') frontmatterSet.add(fm);
    else if (Array.isArray(fm)) for (const t of fm) frontmatterSet.add(t);

    const currentTags = new Set<string>(allTags);
    const sourcesByTag = new Map<string, TagSource[]>();
    for (const tag of currentTags) {
      // A tag may appear in BOTH inline body and frontmatter; record each source
      // so the sidecar's `sources` field reflects every location.
      const seen: TagSource[] = [];
      if (inlineSet.has(tag)) seen.push('inline');
      if (frontmatterSet.has(tag)) seen.push('frontmatter');
      if (seen.length === 0) seen.push('frontmatter'); // via cache but neither set
      sourcesByTag.set(tag, seen);
    }
    return { currentTags, sourcesByTag };
  }

  indexFile(file: TFile): void {
    const now = Date.now();
    const { currentTags, sourcesByTag } = this.readFileTags(file);
    const previousTags = this.fileTags.get(file.path) ?? new Set<string>();
    this.fileTags.set(file.path, currentTags);

    for (const tag of currentTags) {
      for (const source of sourcesByTag.get(tag) ?? ['frontmatter']) {
        this.touchTag(tag, source, now);
      }
    }
    for (const tag of previousTags) {
      if (!currentTags.has(tag)) this.recomputeCount(tag);
    }
    this.scheduleSave();
    this.trigger('changed');
  }

  removeFile(filePath: string): void {
    const previous = this.fileTags.get(filePath);
    if (!previous) return;
    this.fileTags.delete(filePath);
    for (const tag of previous) this.recomputeCount(tag);
    this.scheduleSave();
    this.trigger('changed');
  }

  renameFile(oldPath: string, newPath: string): void {
    const existing = this.fileTags.get(oldPath);
    if (!existing) return;
    this.fileTags.delete(oldPath);
    this.fileTags.set(newPath, existing);
  }

  private touchTag(tag: string, source: TagSource, now: number): void {
    const existing = this.store.get(tag);
    if (!existing) {
      const meta: TagMeta = {
        tag,
        firstSeen: now,
        lastSeen: now,
        count: 1,
        sources: [source],
      };
      // Seed the reviewed mirror from the durable store: a tag can re-enter here
      // (a deleted-then-recreated tag) while settings still hold its reviewed flag.
      // Without this, the incremental path would desync the mirror (settings is
      // authoritative); load()/scanAll() hydrate, so this path must too.
      if (this.reviewed) meta.reviewed = this.reviewed.isReviewed(tag);
      this.store.set(tag, meta);
    } else {
      existing.lastSeen = now;
      if (!existing.sources.includes(source)) existing.sources.push(source);
    }
    this.recomputeCount(tag);
  }

  private recomputeCount(tag: string): void {
    let count = 0;
    for (const set of this.fileTags.values()) if (set.has(tag)) count++;
    const existing = this.store.get(tag);
    if (!existing) return;
    if (count === 0) this.store.delete(tag);
    else existing.count = count;
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void this.flushNow();
    }, this.debounceMs);
  }

  private async flushNow(): Promise<void> {
    this.saveTimer = null;
    const tags: Record<string, TagMeta> = {};
    for (const [tag, meta] of this.store) {
      // reviewed lives in durable settings (P2-09); keep it out of the rebuildable
      // sidecar so the sidecar holds only derived data.
      const copy: TagMeta = { ...meta };
      delete copy.reviewed;
      tags[tag] = copy;
    }
    const payload: PersistedTagMeta = { schemaVersion: SCHEMA, tags };
    const adapter = this.app.vault.adapter;
    const path = this.filePath();
    const dir = path.substring(0, path.lastIndexOf('/'));
    if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
    await adapter.write(path, JSON.stringify(payload, null, 2));
  }

  /**
   * Pull a v1 sidecar's inline reviewed flags into the durable store. Awaited so
   * the durable write completes before the caller hydrates the mirror. The caller
   * gates this on the one-time v10 upgrade (shouldLiftLegacyReviewed), so it does
   * not re-run for a v1 sidecar that reappears after migration.
   */
  private async liftLegacyReviewed(): Promise<void> {
    if (!this.reviewed) return;
    const toLift: string[] = [];
    for (const meta of this.store.values()) if (meta.reviewed) toLift.push(meta.tag);
    if (toLift.length) await this.reviewed.setReviewedTags(toLift, true);
  }

  /** Mirror durable reviewed state onto the in-memory store (settings is the source). */
  private hydrateReviewed(): void {
    if (!this.reviewed) return;
    for (const meta of this.store.values()) {
      meta.reviewed = this.reviewed.isReviewed(meta.tag);
    }
  }

  get(tag: string): TagMeta | undefined {
    return this.store.get(tag);
  }

  /** Mark a single tag reviewed / unreviewed. Delegates to the batched path. */
  setReviewed(tag: string, value: boolean): void {
    this.setReviewedBulk([tag], value);
  }

  /**
   * Mark many tags reviewed / unreviewed in one pass (the triage inbox). Skips
   * tags not in the store and tags already at `value`, then persists once via the
   * debounced save and fires a single `changed` so views repaint once. Tag keys
   * carry no leading '#'.
   */
  setReviewedBulk(tags: string[], value: boolean): void {
    let changed = false;
    const applied: string[] = [];
    for (const tag of tags) {
      const existing = this.store.get(tag);
      if (!existing) continue;
      if (existing.reviewed === value) continue;
      existing.reviewed = value; // mirror for the read path
      applied.push(tag);
      changed = true;
    }
    if (!changed) return;
    // Durable source of truth (survives a sidecar rebuild/loss). The store
    // quiet-persists so this does not trigger the settings rule fan-out.
    void this.reviewed?.setReviewedTags(applied, value);
    this.scheduleSave();
    this.trigger('changed');
  }

  all(): Map<string, TagMeta> {
    return new Map(this.store);
  }

  unload(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      void this.flushNow();
    }
  }
}
