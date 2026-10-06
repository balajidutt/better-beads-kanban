// Source of the bash maps in .opencode/opencode.jsonc: edit here, then run `node .opencode/permissions/generate.mjs`.
const GUARD = 'git --no-optional-locks -c core.fsmonitor=false ';

const guarded = (rule, action) => {
  if (!rule.startsWith('git ')) throw new Error(`guarded rule must start with git: ${rule}`);
  return [[rule, action], [GUARD + rule.slice('git '.length), action]];
};
const git = (...verbs) => verbs.flatMap(verb => [`git ${verb}`, `git * ${verb}`, `command git ${verb}`, `command git * ${verb}`]);
const withCommand = (tool, ...rest) => rest.flatMap(arg => [`${tool} ${arg}`, `command ${tool} ${arg}`]);
const bd = (...subcommands) => subcommands.flatMap(sub => [`bd ${sub} *`, `bd * ${sub} *`, `command bd ${sub} *`, `command bd * ${sub} *`, `*/bd ${sub} *`, `*/bd * ${sub} *`]);
const launched = (dir, name) => [`${name}*`, `${dir}/${name}*`, `./${dir}/${name}*`, `/*/${name}*`];
const asPath = name => [`* ${name}*`, `*/${name}*`, `*"${name}*`, `*'${name}*`, `*=${name}*`, `*:${name}*`];

const readOnlyGit = git('* --output*', '* --no-index*', '* --ext-diff*', '* --textconv*');

export const blocks = {
  common: [
    ...git('commit *', 'push *', 'reset *', 'clean *', 'restore *', 'checkout *', 'switch *', 'stash *', 'rebase *', 'merge *', 'pull *', 'tag *',
      'update-ref *', 'filter-branch *', 'filter-repo *', 'config *', 'gc *', 'prune *',
      'branch -d*', 'branch -D*', 'branch --delete*', 'branch -f*', 'branch --force*', 'branch -m*', 'branch -M*', 'branch --move*',
      'worktree add *', 'worktree remove *', 'worktree move *', 'worktree prune *'),
    'gh *', 'command gh *', '/*/gh *',
    ...withCommand('npm', 'publish*', 'run release:package*'), '*vsce publish*',
    ...launched('scripts', 'release-fork-vsix.sh'),
    ...bd('init', 'dolt', 'sql', 'compact', 'delete', 'hooks', 'vc', 'federation', 'admin', 'migrate', 'import', 'restore', 'backup', 'bootstrap', 'config',
      'sync', 'serve', 'conflicts', 'reclaim', 'unclaim', 'heartbeat', 'hb', 'events', 'provenance', 'codex-hook', 'cursor-hook', 'db-proxy-child',
      'purge', 'prune', 'gc', 'flatten', 'rename', 'rename-prefix', 'migrate-issues', 'migrate-personal', 'doctor', 'batch', 'edit', 'upgrade', 'setup',
      'worktree', 'repo', 'branch', 'mol', 'protomolecule', 'github', 'gitlab', 'jira', 'linear', 'notion', 'ado', 'mail', 'ship'),
    'sh', 'sh *', 'bash', 'bash *', 'zsh', 'zsh *', 'eval *', 'sudo *', 'command sudo *',
    ...asPath('.env'), ...asPath('.ssh'), ...asPath('.beads'), '*auth.json*', '*.npmrc*', '*refs/dolt*',
    'rm -rf /*', 'rm -fr /*', 'rm -r -f /*', 'rm -r -f ~*', 'rm -rf ~*', 'rm -fr ~*', 'rm -rf $HOME*', 'rm -fr $HOME*',
    'dd *', 'mkfs*', 'diskutil *', 'shutdown*', 'reboot*', 'chmod 777*', 'chmod -R 777*'
  ],
  notCi: [
    'oc-commit*', 'command oc-commit*', '/*/oc-commit*', 'cc-commit*', 'command cc-commit*', '/*/cc-commit*',
    'agent-wt-merge*', 'assets/agent-wt-merge*', './assets/agent-wt-merge*', '.opencode/bin/agent-wt-merge*', './.opencode/bin/agent-wt-merge*', '/*/agent-wt-merge*'
  ],
  install: withCommand('npm', 'install*', 'i *', 'ci*', 'update*', 'uninstall*', 'add *', 'rm *', 'remove *', 'un *', 'link*'),
  review: [
    ...git('add *', 'mv *', 'rm *', 'apply *', 'am *', 'cherry-pick *', 'revert *', 'notes *', 'fetch *', 'branch *'), ...readOnlyGit,
    ...withCommand('npm', '*'), ...withCommand('npx', '*'), ...withCommand('node', '*'),
    'node_modules/.bin/*', './node_modules/.bin/*', '/*/node_modules/.bin/*',
    'scripts/*', './scripts/*', '/*/scripts/*', 'assets/*', './assets/*', '/*/assets/*',
    'python*', 'command python*', 'perl *', 'ruby *', 'patch *',
    'sed -i*', 'sed * -i*', 'tee *', 'cp *', 'mv *', 'rm *', 'touch *', 'mkdir *', 'ln *', 'chmod *', 'chown *', 'truncate *',
    'rsync *', 'xargs *', 'find * -delete*', 'find * -exec*', 'curl *', 'wget *'
  ],
  readOnlyGit,
  backlog: ['bd', 'bd *', 'command bd', 'command bd *', '*/bd', '*/bd *', ...launched('scripts', 'bd-sync.sh')]
};

export const roles = {
  "plan": {
    fallback: "deny",
    rules: [
      ...guarded("git log --oneline --decorate --reverse *", "ask"),
      ...guarded("git diff --no-ext-diff --no-textconv --stat *", "ask"),
      ...guarded("git diff --no-ext-diff --no-textconv --name-status *", "ask"),
      ...guarded("git diff --no-ext-diff --no-textconv *", "ask"),
      ...guarded("git show --no-ext-diff --no-textconv *", "ask"),
      ...guarded("git rev-parse *", "allow"),
      ...guarded("git branch --show-current", "allow"),
      ["git --no-optional-locks -c core.fsmonitor=false status", "allow"],
      ["git --no-optional-locks -c core.fsmonitor=false status *", "allow"],
      ...guarded("git diff --no-ext-diff --no-textconv", "allow"),
      ...guarded("git diff --no-ext-diff --no-textconv --cached", "allow"),
      ...guarded("git log --oneline -10", "allow")
    ],
    denyBlocks: [blocks.common, blocks.readOnlyGit],
    afterDeny: [
      ["gh release view v* --repo balajidutt/better-beads-kanban --json assets,author,tagName", "ask"],
      ["gh release view --repo balajidutt/better-beads-kanban --json tagName", "ask"],
      ["gh release download v* --repo balajidutt/better-beads-kanban --pattern SHA256SUMS --output -", "ask"],
      ["command bd --help", "allow"],
      ["command bd show --help", "allow"],
      ["command bd ready --help", "allow"],
      ["command bd blocked --help", "allow"],
      ["command bd list --help", "allow"],
      ["command bd -C * --readonly show *", "ask"],
      ["command bd -C * --readonly ready *", "ask"],
      ["command bd -C * --readonly blocked *", "ask"],
      ["command bd -C * --readonly list *", "ask"]
    ],
    afterRedirect: []
  },
  "build": "deny",
  "plan-reviewer": {
    fallback: "ask",
    rules: [
      ["git --no-optional-locks -c core.fsmonitor=false status", "allow"],
      ["git --no-optional-locks -c core.fsmonitor=false status *", "allow"],
      ...guarded("git diff --no-ext-diff --no-textconv", "allow"),
      ...guarded("git diff --no-ext-diff --no-textconv --cached", "allow"),
      ...guarded("git log --oneline -10", "allow")
    ],
    denyBlocks: [blocks.common, blocks.notCi, blocks.install, blocks.review, blocks.backlog],
    afterDeny: [],
    afterRedirect: []
  },
  "beads-manager": {
    fallback: "ask",
    rules: [
      ...guarded("git rev-parse *", "allow"),
      ...guarded("git branch --show-current", "allow"),
      ...guarded("git worktree list --porcelain", "allow"),
      ["command bd --help", "allow"],
      ["command bd show --help", "allow"],
      ["command bd ready --help", "allow"],
      ["command bd list --help", "allow"],
      ["command bd history --help", "allow"],
      ["command bd create --help", "allow"],
      ["command bd update --help", "allow"],
      ["command bd dep --help", "allow"],
      ["command bd dep add --help", "allow"],
      ["command bd dep remove --help", "allow"],
      ["command bd close --help", "allow"],
      ["command bd -C * --readonly show *", "ask"],
      ["command bd -C * --readonly ready *", "ask"],
      ["command bd -C * --readonly list *", "ask"],
      ["command bd -C * --readonly history *", "ask"],
      ["command bd -C * dep add *", "ask"],
      ["command bd -C * dep remove *", "ask"]
    ],
    denyBlocks: [blocks.common, blocks.notCi, blocks.install],
    afterDeny: launched('scripts', 'bd-sync.sh').map(rule => [rule, "deny"]),
    afterRedirect: [
      ["command bd -C * create *", "ask"],
      ["command bd -C * update *", "ask"],
      ["command bd -C * close *", "ask"],
      ["command bd -C * worktree create *", "deny"],
      ["command bd -C * mol wisp create *", "deny"],
      ["command bd -C * protomolecule wisp create *", "deny"],
      ...['--global', '--db', '--database'].flatMap(flag => [`bd ${flag}*`, `bd * ${flag}*`, `command bd ${flag}*`, `command bd * ${flag}*`, `*/bd ${flag}*`, `*/bd * ${flag}*`]).map(rule => [rule, "deny"])
    ]
  },
  "code-reviewer": {
    fallback: "ask",
    rules: [
      ...guarded("git log --oneline --decorate --reverse *", "ask"),
      ...guarded("git diff --no-ext-diff --no-textconv --stat *", "ask"),
      ...guarded("git diff --no-ext-diff --no-textconv --name-status *", "ask"),
      ...guarded("git diff --no-ext-diff --no-textconv *", "ask"),
      ["git --no-optional-locks -c core.fsmonitor=false status", "allow"],
      ["git --no-optional-locks -c core.fsmonitor=false status *", "allow"],
      ...guarded("git diff --no-ext-diff --no-textconv", "allow"),
      ...guarded("git diff --no-ext-diff --no-textconv --cached", "allow"),
      ...guarded("git diff --no-ext-diff --no-textconv --stat", "allow"),
      ...guarded("git diff --no-ext-diff --no-textconv --cached --stat", "allow"),
      ...guarded("git log --oneline -10", "allow"),
      ...guarded("git rev-parse HEAD", "allow")
    ],
    denyBlocks: [blocks.common, blocks.notCi, blocks.install, blocks.review, blocks.backlog],
    afterDeny: [
      ["command bd --help", "allow"],
      ["command bd show --help", "allow"],
      ["command bd dep --help", "allow"],
      ["command bd dep list --help", "allow"],
      ["command bd -C * --readonly show *", "ask"],
      ["command bd -C * --readonly dep list *", "ask"]
    ],
    afterRedirect: []
  },
  "typescript-specialist": {
    fallback: "ask",
    rules: [
      ["node --version", "allow"],
      ["npm run lint", "ask"],
      ["npm run compile", "ask"],
      ["npm run verify", "ask"],
      ["npm test", "ask"],
      ["npm test -- *", "ask"],
      ...guarded("git diff --no-ext-diff --no-textconv", "allow")
    ],
    denyBlocks: [blocks.common, blocks.notCi, blocks.install, blocks.backlog],
    afterDeny: [],
    afterRedirect: []
  },
  "webview-specialist": {
    fallback: "ask",
    rules: [
      ["node --version", "allow"],
      ["npm run lint", "ask"],
      ["npm run compile", "ask"],
      ["npm run verify", "ask"],
      ["npm test", "ask"],
      ["npm test -- *", "ask"],
      ["node scripts/visual-test-server.js", "ask"],
      ["node scripts/visual-test-server.js *", "ask"],
      ...guarded("git diff --no-ext-diff --no-textconv", "allow")
    ],
    denyBlocks: [blocks.common, blocks.notCi, blocks.install, blocks.backlog],
    afterDeny: [],
    afterRedirect: []
  },
  "test-strategist": {
    fallback: "ask",
    rules: [
      ...guarded("git diff --no-ext-diff --no-textconv", "allow"),
      ...guarded("git diff --no-ext-diff --no-textconv --cached", "allow")
    ],
    denyBlocks: [blocks.common, blocks.notCi, blocks.install, blocks.review, blocks.backlog],
    afterDeny: [],
    afterRedirect: []
  },
  "ci-build-engineer": {
    fallback: "ask",
    rules: [
      ["git --no-optional-locks -c core.fsmonitor=false status", "allow"],
      ["git --no-optional-locks -c core.fsmonitor=false status *", "allow"],
      ...guarded("git diff --no-ext-diff --no-textconv", "allow"),
      ...guarded("git diff --no-ext-diff --no-textconv --cached", "allow"),
      ...guarded("git diff --no-ext-diff --no-textconv --stat", "allow"),
      ["git diff --no-ext-diff --no-textconv --cached | grep -E '^\\+.*(#|//|/\\*)'", "ask"],
      ["grep -E '^\\+.*(#|//|/\\*)'", "ask"],
      ...guarded("git log --oneline -10", "allow"),
      ...guarded("git worktree list --porcelain", "allow"),
      ...guarded("git rev-parse *", "allow"),
      ...guarded("git branch --show-current", "allow"),
      ["node --version", "allow"],
      ["python3 --version", "allow"],
      ["npm run lint", "ask"],
      ["npm run compile", "ask"],
      ["npm run verify", "ask"],
      ["npm test", "ask"],
      ["npm run test:tooling", "ask"],
      ["npm run test:tooling:python", "ask"],
      ["node --test tests/tooling/*", "ask"],
      ["python3 -m unittest discover *", "ask"],
      ["./node_modules/.bin/vsce ls --no-dependencies", "ask"],
      ["git add -- *", "ask"],
      ["*agent-wt-merge*", "ask"]
    ],
    denyBlocks: [blocks.common, blocks.install, blocks.backlog],
    afterDeny: [
      ["npm ci --ignore-scripts", "ask"]
    ],
    afterRedirect: [
      ["oc-commit *", "ask"],
      ...guarded("git log -1 *", "ask"),
      ["*agent-wt-merge*--close-beads*", "deny"]
    ]
  },
  "release-manager": {
    fallback: "ask",
    rules: [
      ...guarded("git log --oneline --decorate --reverse *", "ask"),
      ...guarded("git diff --no-ext-diff --no-textconv --stat *", "ask"),
      ...guarded("git diff --no-ext-diff --no-textconv --name-status *", "ask"),
      ...guarded("git diff --no-ext-diff --no-textconv *", "ask"),
      ...guarded("git rev-parse *", "allow"),
      ...guarded("git branch --show-current", "allow"),
      ...guarded("git ls-files *", "allow"),
      ...guarded("git merge-base --is-ancestor * *", "allow"),
      ...guarded("git ls-remote origin refs/heads/main", "ask"),
      ...guarded("git ls-remote --tags origin refs/tags/v*", "ask"),
      ["git --no-optional-locks -c core.fsmonitor=false status", "allow"],
      ["git --no-optional-locks -c core.fsmonitor=false status *", "allow"],
      ...guarded("git diff --no-ext-diff --no-textconv", "allow"),
      ...guarded("git log --oneline -10", "allow"),
      ["npm run release:bump -- *", "ask"],
      ["node --version", "allow"],
      ["npm run lint", "ask"],
      ["npm test", "ask"],
      ["npm run compile", "ask"],
      ["scripts/build-local-vsix.sh", "ask"]
    ],
    denyBlocks: [blocks.common, blocks.notCi, blocks.install, blocks.backlog, blocks.readOnlyGit],
    afterDeny: [
      ["gh release view v* --repo balajidutt/better-beads-kanban --json assets,author,tagName", "ask"],
      ["gh release view --repo balajidutt/better-beads-kanban --json tagName", "ask"],
      ["gh release download v* --repo balajidutt/better-beads-kanban --pattern SHA256SUMS --output -", "ask"],
      ["command bd --help", "allow"],
      ["command bd show --help", "allow"],
      ["command bd blocked --help", "allow"],
      ["command bd dep --help", "allow"],
      ["command bd dep list --help", "allow"],
      ["command bd -C * --readonly show *", "ask"],
      ["command bd -C * --readonly blocked *", "ask"],
      ["command bd -C * --readonly dep list *", "ask"]
    ],
    afterRedirect: []
  }
};
