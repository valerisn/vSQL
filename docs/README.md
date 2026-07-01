# Docs

The Markdown in here renders on GitHub as-is, and the same files build into a
[VitePress](https://vitepress.dev) site.

```bash
npm run docs:dev       # local preview at http://localhost:5173
npm run docs:build     # static site -> docs/.vitepress/dist
npm run docs:preview    # serve the built site locally
```

## Deploying

The built site is just static files, so it'll go anywhere. Pick whichever fits:

### GitHub Pages (uses GitHub Actions)

The [`docs.yml`](../.github/workflows/docs.yml) workflow builds and deploys on every
docs change. Enable it once under **Settings → Pages → Source: GitHub Actions**.
The default `base` (`/vSQL/`) is already correct for `https://<user>.github.io/vSQL/`.

> Requires GitHub Actions to be available on the account. If Actions is disabled
> (e.g. a billing hold), use one of the no-Actions options below instead.

### Cloudflare Pages / Netlify / Vercel (no GitHub Actions)

These build on their own infrastructure straight from the repo - nothing touches
GitHub Actions, so an Actions/billing hold doesn't matter. Connect the repo and set:

| Setting | Value |
|---|---|
| Build command | `npm run docs:build` |
| Output directory | `docs/.vitepress/dist` |
| Environment variable | `DOCS_BASE=/` *(root domain - omit for a `/vSQL/` sub-path)* |

### Manual / self-hosted

`npm run docs:build` and serve `docs/.vitepress/dist` with any static file server
(nginx, Caddy, `npx serve`, an S3 bucket, etc.). Set `DOCS_BASE` to match the path
the site is served from.
