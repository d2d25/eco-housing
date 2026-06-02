# Eco Housing Beta

A local/static web tool for optimizing Eco housing rooms and browsing housing items from extracted game data.

French notes are kept in [docs/fr](./docs/fr/) for project context, but the main project documentation and issue templates are in English.

## Current Scope

- **Room** page: optimizes one room by room type, tier, size, unlocked skills, owned items, and allowed items.
- **Objects** page: browses housing items with value, craft availability, footprint, room volume, and placement information.
- Beta version: `0.1.0-beta`.

## Run Locally

From the repository root:

```powershell
npm run install:app
npm run dev
```

Then open the URL printed by Vite.

## Test And Build

```powershell
npm test
npm run build
```

The static build is generated in `outputs/`. The file `outputs/eco-data.json` must remain present because the app loads it at runtime.

## Issues

For calculation differences between the app and the game, please include:

- the JSON file exported from the Room page with **Export**;
- a screenshot of Eco's **Room Details** tooltip for the same room;
- a short explanation of what looks wrong.

See [ISSUES.md](./ISSUES.md) for the issue instructions.

## Developer Mode

Developer mode is disabled by default from **Settings**.

When disabled, room item cards only show player-facing information: total XP, total floor used, total required m3, and a small per-copy breakdown when opened.

When enabled, room item cards also show technical/debug details and a copyable Eco admin command in the form:

```text
/give ItemClass,quantity
```

Use this mode when reproducing app-vs-game differences or quickly spawning the optimized objects in a test world.

## Recommended Beta Deployment

### GitHub Pages

1. Create a GitHub repository with this code.
2. In repository settings, open **Pages**.
3. Set **Source** to **GitHub Actions**.
4. Push to `master` or `main`.
5. Share the GitHub Pages URL with beta testers.

The included `.github/workflows/deploy-pages.yml` workflow builds and publishes `outputs/`.

### Vercel

The repository also contains `vercel.json`, so Vercel can deploy the same static build.

### Cloudflare Pages

Equivalent configuration:

- Build command: `npm --prefix work/eco-housing-app ci && npm --prefix work/eco-housing-app run build`
- Build output directory: `outputs`
- Root directory: repository root

## Eco Data Note

`outputs/eco-data.json` and extracted Eco icons/assets are generated from a local Eco installation. They are included for beta testing convenience, but they are not owned by this project and are not covered by any project source-code license.

See [NOTICE.md](./NOTICE.md) before reusing, redistributing, or relicensing generated Eco data or assets.
