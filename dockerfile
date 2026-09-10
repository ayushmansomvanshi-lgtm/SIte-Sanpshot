FROM mcr.microsoft.com/playwright:v1.55.0-jammy

WORKDIR /app

COPY package*.json ./

# Prevent Playwright from downloading browsers into node_modules (use image-provided browsers)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Ensure required system libraries for Chromium are present (fixes libglib and friends)
RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		ca-certificates \
		fonts-liberation \
		libasound2 \
		libatk1.0-0 \
		libc6 \
		libcairo2 \
		libcups2 \
		libdbus-1-3 \
		libexpat1 \
		libfontconfig1 \
		libgcc1 \
		libgconf-2-4 \
		libglib2.0-0 \
		libnss3 \
		libpam0g \
		libpango-1.0-0 \
		libstdc++6 \
		libx11-6 \
		libx11-xcb1 \
		libxcb1 \
		libxcomposite1 \
		libxcursor1 \
		libxdamage1 \
		libxext6 \
		libxfixes3 \
		libxi6 \
		libxrandr2 \
		libxrender1 \
		libxss1 \
		libxtst6 \
		libgbm1 \
		wget \
	&& rm -rf /var/lib/apt/lists/*

RUN npm install

COPY . .

# The base Playwright image already contains browsers and required deps.
# Keep `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` so npm/postinstall won't try to download again.

EXPOSE 3000

CMD ["npm", "start"]
