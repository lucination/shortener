# Shortener frontend

SvelteKit static-adapter SPA, Svelte 5, Tailwind v4, static Storybook. No Node server is needed by the app runtime. Backend must serve existing build files, route known SPA paths, preserve real missing-asset 404s and short-address routing precedence, and use `build/200.html` only for the agreed shell fallback.

```sh
cd web
npm ci
npm run sync-contracts
npm run check-contracts
npm run check
npm test
npm run build
npm run build-storybook
```

`build/` contains the SPA. `storybook-static/` contains the isolated design workbench. `node scripts/verify-browser.mjs` expects the latter at `http://127.0.0.1:6006` and requires `npx playwright install chromium`. Screenshots and machine-readable evidence go under ignored `test-results/`.

The stylesheet preserves the user's supplied character-grid design: JetBrains Mono (locally hosted normal and italic variable WOFF2 faces, full weight range 100–800, no ligatures, no synthetic faces), warm paper and charcoal themes, square 2px borders, boxed tables, double rules. Light/dark override system preference. Font binaries are the Latin variable assets from `@fontsource-variable/jetbrains-mono`, pinned by `package-lock.json`; JetBrains Mono uses the SIL Open Font License in `static/fonts/OFL.txt`. Verify binary axes with `python scripts/check-fonts.py` (requires fonttools and brotli), and every normal/italic weight in Chromium with the browser script. Monospace Web design attribution: Oskar Wickström, MIT, https://owickstrom.github.io/the-monospace-web/ . See `THIRD-PARTY-NOTICES.md`.

Read `ARCHITECTURE.md` for the required stateless/stateful isolation and functional core boundaries. Stories are simulated, never live data. All network contracts are generated from serialized backend Rust DTOs, with checked runtime parsing.
