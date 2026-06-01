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

## Recommended Beta Deployment

### Vercel

1. Create a GitHub repository with this code.
2. Import the repository in Vercel.
3. Let Vercel use `vercel.json`.
4. The site is served from `outputs/`.

Every push to the main branch creates a deployment. Pull requests can also produce preview URLs.

### Cloudflare Pages

Equivalent configuration:

- Build command: `npm --prefix work/eco-housing-app ci && npm --prefix work/eco-housing-app run build`
- Build output directory: `outputs`
- Root directory: repository root

## Eco Data Note

`outputs/eco-data.json` contains data extracted from a local Eco installation. This is practical for a private beta, but redistribution rights should be checked before a broad public release.
