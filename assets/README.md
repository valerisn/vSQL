# Brand assets

| File | Use |
|---|---|
| `logo.svg` | Horizontal lockup (icon + wordmark). Used in the README header. |
| `icon.svg` | Square icon only. Favicon / avatar / docs logo. |
| `social-card.svg` | 1280×640 card for the GitHub social preview and link unfurls. |

Palette: ink `#0f172a`, accent gradient `#7dd3fc → #0891b2`, text `#e2e8f0`.

## Setting the GitHub social preview

GitHub's social preview must be a **PNG/JPG** uploaded under
**Settings → General → Social preview**. Export `social-card.svg` to PNG first, e.g.:

```bash
# with rsvg-convert (librsvg)
rsvg-convert -w 1280 -h 640 assets/social-card.svg -o social-card.png
# or with Inkscape
inkscape assets/social-card.svg --export-type=png -w 1280 -h 640 -o social-card.png
```

Then upload `social-card.png` in the repo settings.
