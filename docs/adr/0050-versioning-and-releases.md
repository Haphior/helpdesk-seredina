# ADR 0050: Versioning and release process

## Status

Accepted, implemented (`v0.1.0-alpha.1`).

## Context

The project had no version number, no tags, and no GitHub Releases — every
change just landed on `main`. That's fine for a solo-maintained repo that
hasn't been announced anywhere, but it stops working the moment anyone else
deploys it: without a version number there's no stable thing to say "I'm
running X" about, no changelog to read before upgrading, and no way to pin a
Docker image tag to something other than `latest`/a commit SHA.

## Approach

**SemVer, pre-1.0.** `0.1.0-alpha.1` — the `0.x` major signals "the public
contract (API, self-hosted upgrade path, DB migrations) can still break
between releases," which is honest: Phases 0-5 are feature-complete per
`docs/ROADMAP.md`, but nobody outside this project has run it in production
yet, so treat every alpha as capable of shipping breaking changes without a
major bump until `1.0.0`. `alpha.N` (not `beta`/`rc`) because there's no
public user base yet to validate against — the label should stay honest as
that changes.

**One version for the whole monorepo, not per-package.** Every
`apps/*`/`packages/*` workspace is `"private": true` and never published to
npm individually (`docs/adr/*` and the repo layout make clear this ships as
one deployable product, not a library collection) — so the root
`package.json`'s `version` field is the single source of truth, bumped by
hand alongside the release, not by a tool like Lerna/changesets that exists
to solve independent-package versioning this project doesn't have.

**`CHANGELOG.md`, hand-maintained, Keep a Changelog format.** The project
already commits per finished feature (see the "commit per feature" practice
this session), so the discipline of also touching an `[Unreleased]` section
in the same commit — or shortly after — costs little and produces a real,
human-readable changelog instead of a wall of squashed commit subjects.
GitHub's auto-generated release notes (from PR/commit titles) were the
alternative; rejected because this repo doesn't use PRs for solo work, so
commit-title-based notes would read like an internal diary, not release
notes for a self-hosting operator deciding whether to upgrade.

**Release mechanics**: annotated git tag `vX.Y.Z[-prerelease]` on `main`,
pushed, then `gh release create <tag> --notes-file <(sed ...)` pulling that
version's section straight out of `CHANGELOG.md` as the release body — no
separate release-notes authoring step. `--prerelease` is passed for every
`0.x` and every `-alpha`/`-beta`/`-rc` tag; only a `1.0.0`+ final tag omits
it.

## Next release checklist

1. Move `[Unreleased]` entries in `CHANGELOG.md` under a new `## [X.Y.Z] -
   YYYY-MM-DD` heading (add an `[Unreleased]` link diff and a version link at
   the bottom, matching the existing entries).
2. Bump root `package.json`'s `version` to match.
3. Commit both (`chore: release vX.Y.Z`), push.
4. `git tag -a vX.Y.Z -m "vX.Y.Z"`, `git push --tags`.
5. `gh release create vX.Y.Z --title vX.Y.Z --notes-file <path> [--prerelease]`.

## Consequences

- A self-hosting operator can now pin a Docker deployment to a real release
  tag instead of `main`/a commit SHA, and read `CHANGELOG.md` before
  upgrading.
- Slightly more ceremony per release (the checklist above) — acceptable; it's
  a handful of steps, not a release-engineering system, and matches the
  project's existing bias toward hand-rolled-and-simple over tooling that
  solves a bigger problem than this one has (same reasoning as the guided
  tour and dashboard drag-and-drop being hand-rolled rather than pulling in a
  library).
