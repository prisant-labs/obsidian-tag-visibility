import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The display-only invariant, enforced instead of promised.
 *
 * CLAUDE.md states the contract: "never add code that writes note content or makes
 * network requests; the only persistence is saveData (data.json) and the
 * plugin-folder sidecar (tags.json)". docs/TESTING.md asks a human to confirm "No
 * .md file was modified" by uninstalling and looking. That is the plugin's entire
 * value proposition resting on a tick box.
 *
 * It does not have to. The contract is a static property of the source, so these
 * tests read src/ and fail the build if a future commit ever reaches for a
 * note-writing or network API. A reviewer can forget the invariant; the suite
 * cannot.
 */

const SRC = join(__dirname, '..', 'src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Strip comments so prose ABOUT these APIs never trips the scanners. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const FILES = sourceFiles(SRC).map((f) => ({
  path: relative(SRC, f).replace(/\\/g, '/'),
  code: stripComments(readFileSync(f, 'utf8')),
}));

describe('display-only invariant', () => {
  it('has source files to scan (guards against a silently empty sweep)', () => {
    expect(FILES.length).toBeGreaterThan(10);
  });

  // Every Vault API that can change a note. Reading (read, cachedRead, getMarkdownFiles,
  // getAbstractFileByPath) is fine and is what the plugin actually does.
  it('never calls a Vault API that can write, move, or destroy a note', () => {
    const forbidden =
      /\bvault\s*\.\s*(modify|modifyBinary|create|createBinary|createFolder|delete|trash|rename|copy|append|process)\s*\(/g;
    const hits: string[] = [];
    for (const { path, code } of FILES) {
      for (const m of code.matchAll(forbidden)) hits.push(`${path}: vault.${m[1]}()`);
    }
    expect(hits).toEqual([]);
  });

  it('never makes a network request', () => {
    const forbidden = /\b(requestUrl|fetch|XMLHttpRequest|WebSocket|EventSource|navigator\s*\.\s*sendBeacon)\s*\(/g;
    const hits: string[] = [];
    for (const { path, code } of FILES) {
      for (const m of code.matchAll(forbidden)) hits.push(`${path}: ${m[1]}()`);
    }
    expect(hits).toEqual([]);
  });

  /**
   * The allowlist. Not "no writes" - the plugin has exactly two, and both live
   * outside the vault's notes:
   *   settings.ts  saveData()      -> data.json     (Obsidian's own plugin store)
   *   tagMeta.ts   adapter.write() -> tags.json     (inside the plugin folder)
   * A third write appearing anywhere is a design change that must be argued for,
   * not slipped in. If you are here because this test failed: that is the point.
   */
  it('has exactly two persistence call sites, both outside the vault notes', () => {
    const writes = /\.\s*(saveData|write|writeBinary)\s*\(/g;
    const found: string[] = [];
    for (const { path, code } of FILES) {
      for (const m of code.matchAll(writes)) found.push(`${path}: ${m[1]}()`);
    }
    expect(found.sort()).toEqual(['storage/settings.ts: saveData()', 'storage/tagMeta.ts: write()']);
  });

  it('writes the sidecar only into the plugin folder, never a vault path', () => {
    const tagMeta = FILES.find((f) => f.path === 'storage/tagMeta.ts');
    expect(tagMeta).toBeDefined();
    // The write target is filePath(), which is built from manifest.dir (the plugin
    // folder) and never from a TFile path or user input.
    expect(tagMeta!.code).toMatch(/adapter\s*\.\s*write\(\s*path\s*,/);
    expect(tagMeta!.code).toMatch(/manifest\s*\.\s*dir\s*\?\?\s*`\.obsidian\/plugins\//);
  });
});
