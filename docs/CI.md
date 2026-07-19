# CI and the release pipeline

How this repo verifies itself and how a release gets cut. Everything here is grounded in the three
workflow files under [`.github/workflows/`](../.github/workflows/); if this document and a workflow
ever disagree, the workflow is the truth and this file has drifted.

## The verification gate

One chain, identical locally and in CI:

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

| Step | Command under the hood | What it proves |
|---|---|---|
| Lint | `eslint src tests --max-warnings 0` | Zero errors AND zero warnings across shipped source and the test suite. No file is exempted; the config says so and why. |
| Typecheck | `tsc --noEmit` | `src/` compiles clean under `strict: true`. |
| Test | `vitest run` | The full unit suite passes (engine, storage migrations, all four observers, integrations, UI models). |
| Build | `node esbuild.config.mjs production` | `main.js` builds, minified, sourcemap-free, with `obsidian`/`electron`/editor packages externalized. |

CI additionally verifies all four artifacts exist after the build: `main.js`, `manifest.json`,
`styles.css`, `versions.json`. Only the first three are attached to releases; `versions.json`
is consulted by Obsidian from the repository, and the directory validator rejects it as a
release asset. Release assets also carry GitHub artifact attestations (build provenance).
Both behaviors come out of the community directory's automated review; the finding-by-finding
record is [DIRECTORY-REVIEW.md](DIRECTORY-REVIEW.md).

## The three workflows

### `build.yml` - the gate

- **Triggers:** every push to **any branch**, and every pull request into `main`. Work-in-progress
  branches get continuous verification, so nothing can land on `main` having never seen CI. A
  same-repo PR runs the gate twice (push ref and PR merge ref); that duplication is the accepted
  cost of also covering fork PRs. Tags are deliberately excluded: `release.yml` owns tags.
- **Concurrency:** a newer commit on the same ref cancels the in-flight run.
- **Permissions:** `contents: read` only. This workflow can never write to the repo.
- **Node:** from [`.nvmrc`](../.nvmrc) via `node-version-file`, so the workflow file never hardcodes
  a Node version. Bump Node by editing `.nvmrc`.

### `codeql.yml` - static security analysis

Runs the `security-and-quality` CodeQL suite for JavaScript/TypeScript on pushes and PRs to `main`,
plus a weekly Monday scan so newly published query packs re-check the unchanged tree. Not a merge
gate, but findings land in the repo's Security tab.

### `release.yml` - the tag-triggered publisher

Fires on any tag push and, in order:

1. **Re-runs the full verification gate at the tagged commit.** A tag can point at any commit, not
   necessarily a green `main`, so the gate runs again here; a tag on a red commit fails before
   anything is published.
2. **Verifies the artifact quartet exists.**
3. **Verifies the tag equals `manifest.json`'s version** (Obsidian plugin tags carry no leading
   `v`). A mis-tagged release fails loudly before publishing.
4. **Publishes a GitHub release** with the four assets via `softprops/action-gh-release`, which is
   **pinned to a commit SHA** (not a movable tag) because this is the one `contents: write`
   workflow; a repointed upstream tag cannot swap unreviewed code into it. A tag containing `-`
   (for example `1.0.0-rc.9`) publishes as a pre-release; a plain `x.y.z` tag publishes as a full
   release and becomes GitHub's "Latest".

## Cutting a release

The version source of truth is `npm version`; everything else syncs from it.

```bash
# 0. Be on main with a clean tree, all changes merged.
# 1. Wait for build.yml to be GREEN on main for the exact commit you will tag.
#    (Tagging a commit CI has not blessed means a red release.yml after the tag
#    is already pushed; recovery is fix, delete tag, re-tag.)
npm version 1.0.0        # or 1.0.1, 1.1.0-rc.1, ...
git push origin main
git push origin 1.0.0    # the bare tag (no v prefix; .npmrc sets tag-version-prefix="")
```

What `npm version` does here:

1. Bumps `package.json` and both `package-lock.json` version fields.
2. Runs the `version` script: `version-bump.mjs` rewrites `manifest.json`'s version and adds a
   `versions.json` entry mapping the new version to the current `minAppVersion` (tab-indented,
   trailing newline, key order preserved), then stages both files.
3. Commits everything and creates the **annotated, bare** tag (no `v` prefix, per
   [`.npmrc`](../.npmrc)); Obsidian's ecosystem expects bare semver tags.

The tag push triggers `release.yml` (above). After a plain release publishes, it automatically
becomes both GitHub's "Latest" and the newest release BRAT resolves.

`versions.json` only matters when `minAppVersion` changes: Obsidian consults it to find the newest
plugin version compatible with an older app. Entries all mapping to the same `minAppVersion` are
harmless history.

## Dependency policy

[Dependabot](../.github/dependabot.yml) runs weekly for both npm and GitHub Actions:

- `@types/node`: major bumps declined; it tracks the Node major in `.nvmrc`, not the newest Node.
- `obsidian`: held off 1.13.1 (its `obsidian.d.ts` is self-inconsistent and fails `tsc`); the
  lockfile pins 1.12.3. Re-evaluate when a fixed typings release ships.
- First-party GitHub actions (`actions/checkout`, `actions/setup-node`, `github/codeql-action`) are
  pinned by major tag in the read-only workflows; the only third-party action, in the privileged
  release workflow, is SHA-pinned. That split is deliberate: pin strength scales with workflow
  privilege.

## Known gaps (accepted, documented)

- **Tests run but are not typechecked.** Vitest transpiles test files without `tsc`, and the tests
  resolve `obsidian` to a deliberately minimal stub (`tests/_stubs/obsidian.ts`) whose shapes
  diverge from the real API, so a `tsc` pass over `tests/` would need a full-fidelity typed stub.
  Until that stub exists, a type error in a test file surfaces only if it changes runtime behavior.
  Lint does cover `tests/`.
- **CodeQL is advisory,** not a required check; treat a new alert as a stop-and-look, not noise.
