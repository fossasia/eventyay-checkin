## Development checks

This repository is a Vue 3 / Vite JavaScript app. Python tooling from the main Eventyay repo (for example `ruff`) does not apply here — use the npm scripts below instead.

### Setup

```bash
npm ci
```

### Before opening a pull request

Run the same checks as CI:

```bash
npm run lint          # ESLint (check only; use npm run lint:fix to auto-fix)
npm run format:check  # Prettier
npm run test:unit -- --run
npm run build
```

Optional local fixes:

```bash
npm run lint:fix
npm run format
```

### Tooling

| Tool | Config | Purpose |
|------|--------|---------|
| ESLint | `.eslintrc.cjs` | Vue/JS lint rules (`vue/no-dupe-keys`, etc.) |
| Prettier | `.prettierrc.json` | Formatting for unit tests under `src/utils/__tests__/` |
| Vitest | `vitest.config.js` | Unit tests (`src/**/__tests__/*.spec.js`) |

CI runs lint, test formatting check, unit tests, and production build on pull requests (see `.github/workflows/ci.yml`).

### Tests

Place unit tests next to the code they cover, under `__tests__/`, using the `*.spec.js` suffix. Prefer testing pure utilities and coordinators that underpin check-in flows (session parsing, server URL resolution, device errors, list cache).
