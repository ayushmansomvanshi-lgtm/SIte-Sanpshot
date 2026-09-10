Deploying to Render

1. Go to https://dashboard.render.com and sign in.
2. Click "New +" → "Import a Git Repository" and connect your GitHub account if needed.
3. Select the repository `ayushmansomvanshi-lgtm/SIte-Sanpshot` and branch `main`.
4. Render should detect `render.yaml` and offer to create the `site-snapshotter` service using the Dockerfile.
5. Ensure the service's build log completes. The Docker image will be built on Render and Playwright browsers will be installed during the image build (the Dockerfile runs `npx playwright install --with-deps`).

Notes
- If you prefer Render to build from source using the Dockerfile, no additional CI is required.
- If you need automatic image builds on push and then deploy to Render, I can add a GitHub Actions workflow that builds and pushes to GHCR and triggers a Render deploy (requires a `RENDER_API_KEY`).
