# Workflow tooling provenance

## Grant and source

Grantor: **Balaji Dutt**. File-scoped MIT permission for the inventory below was
reaffirmed on **2026-09-24**. See
[THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) and the
[permission text](../../LICENSES/dotfiles-workflow-MIT.txt). This is not a grant
for unrelated upstream files or host deployment configuration.

Source repository: <https://gitlab.com/balaji-personal-files/dotfiles>.
Pinned revision: `a90487cdfbcd1f672a62a6417a544a12cb4461a7`.
Source paths resolve beneath that revision's `/-/blob/` or `/-/raw/` URL.
Source hashes are **Git blob SHA-1 object IDs**, obtained from the public GitLab
tree API; destination hashes below are **SHA-256 of local file bytes**. The two
algorithms are intentionally distinguished. Runtime copies were compared using
Git blob IDs; the large entrypoint also matched the retrieved source with a
complete no-index comparison before its documented Beads adaptation.

## Imported runtime and schema

Source and destination paths are identical unless a mapping is shown. Modes are
destination modes; the upstream pre-push template is 100644 and its destination
is executable. The other listed modes retain the source's mode.

| Source → destination | Source blob | Destination SHA-256 | Mode / adaptation |
| --- | --- | --- | --- |
| `assets/agent-wt-merge` | `0f373bc37b2be6bd3014c399901790be9941c720` | `23b7debc1f77a9cd2f7aa2318e9acb257839c894965989ac5ed3472ea4d73d76` | 100755; legacy Beads state inspection disabled, helper-owned closure rejected and removed from help |
| `assets/resolve-python3` | `9db29949d21b98091916b69ad59887d48f6c998c` | `4a6542f84467d97b4180b5d0281b4f86f918d0fbfa9c1c6eba4cc23438f1de69` | 100755; unchanged |
| `assets/check-pipeline.py` | `631118e9367f404d7ac28808cd2b8ee70602e9d3` | `959c13638b2baebf038551551bf79658c64a287f03c51548f4358c73515bbb69` | 100644; unchanged |
| `assets/pipeline_guard.py` | `23b25e2e702196e57af3ff9cce0e12a8aa1423f9` | `ba34d8f3de404175217a4fd9c0f5ce094fb4ed46cf77c02d64abcc4d48413ba6` | 100644; unchanged |
| `assets/pipeline_policy.py` | `50b25da3407495a1562237e551c7ca0e27e5d3a0` | `b9ea6daa46cf1d9ea2bcf8ed9eb60f8045fe046db55b617fd0a32abceecb0646` | 100644; explicit SSH-only `github-balajidutt` alias normalization |
| `assets/pipeline_runtime.py` | `a58d847cf27fe7aa12affce60d6748d71b2c0338` | `f8bb14aff19de0b0402b2f92b900e3dd77fa13876626f6b93f5da0bb62ebf4fe` | 100644; unchanged |
| `assets/github_pipeline.py` | `215476b9a43fb592d849be9772c919ffc07ce076` | `05bab46a24e665b55401af16b41f3028515904564d910eefc45975f38fd91016` | 100644; unchanged |
| `assets/pipeline_evidence.py` | `c2328f2c3d13393cb024707b91e382685bf3ac34` | `58509de2c86fb55329b6d96adbd42d9582b04f5402affd1cab0f7e178ca5f156` | 100644; unchanged |
| `assets/gitlab_pipeline_runtime.py` | `0b52e85cd2287dc90999d0372b9a9455bfe10583` | `6e1da38c7aef8673cf645398cb2c56737890a93e44b463c1dd1afb6e135dae93` | 100644; unchanged shared dependency, not GitLab policy adoption |
| `assets/check-gitlab-pipeline.py` | `57a31e83a77119be72b2d056563ca5823ac9769f` | `3c8916f077981983b3f3ae38773971c2421b507e5143be7c6652db84f5e0daae` | 100644; unchanged shared dependency |
| `configs/schemas/pipeline-guard.v1.schema.json` | `e518ef08d7fcf1aa3ff062e221af1130b58044d3` | `9d8571cd25c141961169bbe63919a6237b1bd9121e85a0fccbe1035fd42596be` | 100644; unchanged |
| `private_dot_config/git/template/hooks/executable_pre-push` → `scripts/hooks/pre-push` | `21791eaec2b00fee9b4030348faddc6b9d5bd2f9` | `9567e33e0cf0b5d74519fa4c363dcc991e7f068b3fb3eda968f4b102078c0d3f` | 100755; path/mode adaptation only; not installed |

The maintained merge/CI-evidence algorithm is retained. Legacy helper Beads state
is not an issue-data source for this repository. OpenCode closure remains a
separately approved beads-manager operation through `bd`.

## Review-loop adaptations

All destinations below have mode 100644. Configuration parsing, bounded state,
worktree alias normalization, SDK call handling and marker parsing are shared in
`.opencode/lib/review-loop.js`. The derived plugins use the repository's reviewer
and marker contract, specific task/session correlation, a captured revision at
review start, and no broad legacy sentinel clearing. Confirmed request rejection
retains retry eligibility; uncertain delivery is not replayed automatically.

| Source / destination | Source blob | Destination SHA-256 |
| --- | --- | --- |
| `.opencode/plugins/review-loop-marker.js` | `8bf5b3fab5751380769b60e5ad662021f15a5cf5` | `cbefb2913996a0ee0bf3c7204c57a1586199b4bbe83a5a43a5dc3e66bf5d8d58` |
| `.opencode/plugins/review-loop-enforcer.js` | `52cb9da627577c9f88c7a625ad49b8f3ef875bdc` | `5ab1289623d2bffcb5f8fa6a0a0e49d5c6ffe17d8052e2a75ccfa5a60fac034d` |
| `.opencode/plugins/review-loop-gate.js` | `d379ec390ca11082ea4c4a71ac96f3dd071524c9` | `d5ca38d80fba9b0b602aba7399adef20b57d78825074fc8e45cf848cbf165cd1` |
| Shared portions of those three sources → `.opencode/lib/review-loop.js` | The three preceding source blobs | `5520b2340a2271549572ebed82d5c3a96366050ac53fe0d45fd4a4177d5d672c` |

The plugins are reminders, not authenticated or digest-bound commit approval.
No global attestation producer, private source distribution, host installer or
upstream test registry is incorporated.

## Selected test support

These are selected/adapted cases, not a claim that the entire upstream suite ran.
Imports and repository-root lookup target this checkout; fixtures isolate home,
Git configuration, credentials and command state. The support is limited to the
used standard-library operations, includes Python 3.10-compatible context cleanup,
and excludes upstream helper-owned Beads closure scenarios. All modes are 100644.

| Source → destination | Source blob | Destination SHA-256 |
| --- | --- | --- |
| `tests/test_github_pipeline.py` → `tests/tooling/test_github_pipeline.py` | `c8621a7507dc47fd3ff60802760d628d7a9265c4` | `8170322ee13999b94d23d7b063806a3297371e6ebbcb06f4b0973ea55d6a8744` |
| `tests/test_pipeline_evidence.py` → `tests/tooling/test_pipeline_evidence.py` | `8acd582271aeffc527a9d6f5079b26c97111b106` | `c82f463e4046cfbf4d36459da5258f6b62f52ea7f1799b22ae509238da66ecdb` |
| `tests/test_github_worktree_merge.py` → `tests/tooling/test_github_worktree_merge.py` | `85daa267854432b6f845ec6ee8e187a02c95b681` | `33d439807baf5af309eeaabcee513a7e485ebebcb511ea887a4192498ba8271e` |
| `tests/test_pipeline_guard.py` → `tests/tooling/test_pipeline_guard.py` | `4009479cec4fb0546e3a3aca6b1e6ccdaa85f245` | `180b3f1aefa5556499a0aa936d2149919c014c268d96828ba644e9ae50f3f87f` |
| Portions of `tests/support/fixtures.py` → `tests/tooling/support/fixtures.py` | `c78065020bc130a3832560a0a200fbaf01feab02` | `d51445516743195d74697e6001f3783fbe6ac26955ffba717fe0f34794f4090c` |
| `tests/support/github_fixtures.py` → `tests/tooling/support/github_fixtures.py` | `70790bbee6dbc645249fbd0863820231cb23d3cd` | `b0e563e4502aae45d5d336312ce7f03d030d65f17460bb7a220abee225862c99` |
| GitFixture portions of `tests/test_agent_wt_merge.py` → `tests/tooling/support/agent_wt_merge_fixtures.py` | `7e785d3c6c4721ab44dddcb627a8e75215a92f78` | `3a4feb40a2d5c3b32508ccfedabc5fe4cb1d6bc96f3a1af1e689264df787fed4` |

## Maintenance

Update the complete required bundle from one reviewed public revision. Preserve
the local SSH alias and Beads boundaries, recheck source rights and update this
manifest for actual changes. Scope any new upstream files before incorporation.
Pin tooling dependencies through their respective npm lockfiles; do not copy
installed packages from another checkout or rely on an implicit `npx` download.

The global `oc-commit`/`cc-commit` attestation producers are an external capability.
Their participation records are not proof of approval of the current diff, and
their presence or source-pair completeness is not a repository prerequisite.
