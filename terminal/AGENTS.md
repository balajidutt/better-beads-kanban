# Terminal prototype

This private Node 22+ ESM package is separate from the extension's CommonJS build.
Run its checks from the repository root: `npm --prefix terminal run typecheck`,
`npm --prefix terminal run lint`, `npm --prefix terminal test` and
`npm --prefix terminal run build`. Its dependencies install with
`npm --prefix terminal ci --ignore-scripts`; in OpenCode only ci-build-engineer runs that.
Do not install native development tools on macOS. PTY and
native build work belongs in a disposable Linux environment.

Consume shared code through `src/shared/model.ts` or `src/shared/node.ts`; do not
import the extension adapter. Repository discovery and filter constants may use
the existing UI-independent modules. No SQL, JSONL, mutation, sync, database
lifecycle or agent-dispatch commands belong in the application. Runtime services
expose only list, detail and disposal. Fixture setup is separate.

Keep terminal dependencies and outputs out of the VSIX. The provisional shared
source layout requires a packaging decision before either frontend graduates to
a second maintained deliverable. Checkpoint B acceptance does not authorize
commits, pushing or publication.
