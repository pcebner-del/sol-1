# Deploying SOL–1

Everything a deploy needs, in one place.

## 1. Where's the code

Local only — `~/Desktop/sun-explorer` on Phil's Mac. **Not yet a git repo**
(no `.git`, no remote), so it needs pushing up first.

There is nothing private in it: no secrets, no credentials, no proprietary
assets. A `.gitignore` is in place covering `node_modules/`, `dist/`,
`.claude/` (local editor tooling) and `.vercel`.

Source tree is ~960 KB. Commit `package-lock.json` — it's there and pins the
dependency tree.

## 2. Build setup

**Vite 7 + vanilla JS ES modules.** No framework — no React, no Next, no JSX,
no TypeScript. One dependency at runtime.

| | |
|---|---|
| Framework preset | **Vite** |
| Install | `npm ci` (or `npm install`) |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | 24 locally (v24.16.0); any Node ≥ 18 is fine |
| Dependencies | `three@^0.180.0` (runtime), `vite@^7` (dev) |

Those are Vercel's defaults for the Vite preset, so **no `vercel.json` is
needed** — auto-detection gets it right. One is only worth adding if you want
explicit cache headers.

Build output is three files, ~656 KB total (~170 KB gzipped — nearly all of it
is three.js):

```
dist/index.html
dist/assets/index-[hash].css
dist/assets/index-[hash].js
```

## 3. Environment variables

**None.** The site needs zero configuration to run.

One thing that looks like an exception but isn't: `vite.config.js` reads
`process.env.PORT` to pick a dev-server port. That is **dev only** — it has no
effect on `vite build` and no effect in production. Do not set a `PORT` var.

## Notes that matter for hosting

- **Fully static.** No backend, no serverless functions, no API routes, no
  database. It is three files on a CDN.
- **No outbound requests at runtime.** Verified: no `fetch`, no `XMLHttpRequest`,
  no WebSockets, no external URLs anywhere in the source. Every visual is
  generated procedurally in shaders and canvas at load — including Earth's
  coastlines and the film grain — and the audio is synthesised with the Web
  Audio API. Nothing is downloaded, so nothing can break from a dead CDN, and
  it works offline once loaded.
- **No special headers required.** WebGL and Web Audio need nothing beyond
  normal static hosting. No `SharedArrayBuffer`, so no COOP/COEP needed.
- **Single page, no client-side routing.** No SPA rewrite rules needed.
- **Asset filenames are content-hashed**, so `/assets/*` is safe to cache
  immutably. `index.html` should not be.
- **Audio needs a user gesture.** Sound is on by default but browsers only let
  it start after the first interaction, which the entry button provides. Nothing
  to configure — just don't be surprised that it's silent until the first click.
- **Renders heavy on first paint.** The app auto-detects device capability and
  picks a quality tier; the boot screen prints which one it chose. No action
  needed, just useful when someone reports it looking different on their phone.

## Domain

`sol-1.space` → point at the Vercel deployment. No app-side config depends on
the hostname, so no code change is needed when the domain is attached.

## Sanity check before shipping

```bash
npm ci && npm run build && npm run preview
```

`preview` serves the real production bundle. Expect the SOL–1 entry screen,
then a rotating sun with a live HUD after clicking through.
