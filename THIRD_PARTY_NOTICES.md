# Workflow tooling notices

The selected workflow tooling identified in
[tooling provenance](docs/development/tooling-provenance.md) is derived from
[Balaji Dutt's public dotfiles](https://gitlab.com/balaji-personal-files/dotfiles)
at revision `a90487cdfbcd1f672a62a6417a544a12cb4461a7`.

Balaji Dutt granted file-scoped MIT rights for the exact selected source inventory,
reaffirmed on 2026-09-24. The grant does not
license unrelated dotfiles content. Copyright (c) 2026 Balaji Dutt. The applicable
permission and disclaimer are in [LICENSES/dotfiles-workflow-MIT.txt](LICENSES/dotfiles-workflow-MIT.txt).

The three review-loop plugins and their shared utilities are adaptations. The
merge runtime, hook source, schema and selected test support retain their
source provenance; the manifest records local adaptations and modes.

Configuration-local `picomatch` and `jsonc-parser`, and the packaging tool
`@vscode/vsce`, retain their own package licenses and notices in the locked
dependency distributions. No third-party dependency implementation is vendored
from a separate checkout. These development tools and the selected dotfiles
sources are excluded from the VSIX. Their notices may be excluded from that
artifact only while its actual listing contains none of the corresponding code.
The extension's own LICENSE and required runtime assets/notices remain included.
