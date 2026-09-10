# Site Snapshotter

Site Snapshotter is a local web app that inspects up to 30 website URLs to find up to five representative pages, identifies different page designs, takes full-page screenshots with Chromium, and downloads one organized ZIP folder.

The export contains up to five unique representative page types. Repeated templates are ignored, and one individual blog post is prioritized when the website exposes a post link within the discovery limit.

## Quick start on macOS

1. Install [Node.js 20+](https://nodejs.org/) if it is not already installed.
2. Double-click `start.command`.
3. If macOS blocks it, right-click `start.command`, choose **Open**, then confirm.
4. The app opens at `http://localhost:4173`.

The launch command checks Playwright and Chromium automatically, so it also repairs the common “Executable doesn't exist” error after a Playwright update.

## Terminal start

```bash
npm install
npx playwright install chromium
npm start
```

Then open `http://localhost:4173`.

## Export contents

Every capture downloads a ZIP containing:

- `screenshots/desktop/` — 1440 px desktop PNG files
- `screenshots/tablet/` — 834 px tablet PNG files
- `screenshots/mobile/` — 390 px mobile PNG files
- `representatives.csv` — the selected representative pages and screenshot filenames
- `scan-log.csv` — every inspected URL, including skipped duplicate designs and errors
- `report.json` — machine-readable capture results
- `README.txt` — capture summary

## Notes

- Only same-site HTTP/HTTPS links are followed by default.
- Asset links such as images, PDFs, CSS, JavaScript, videos, and archives are skipped.
- Every run exports up to five page types (four non-post types and one blog post). It may inspect up to 30 URLs; unavailable page types result in fewer captures.
- Select **All screens** to create Desktop, Tablet, and Mobile folders together.
- Sign-in pages, bot protection, cookie prompts, and infinite-scroll pages may need custom handling.
- Only capture websites you own or have permission to archive.

## Dark edition v5

The removed Smart Selection section is no longer shown. Each device folder has clearly device-prefixed PNG filenames. The portal reports counts for Desktop, Tablet and Mobile and exposes missing-device warnings. Page-type selection is heuristic, not pixel-level visual deduplication.
# SIte-Sanpshot
# site-snapshotter
# site-snapshotter
