FROM mcr.microsoft.com/playwright:v1.55.0-jammy

WORKDIR /app

COPY package*.json ./

RUN npm install

# Install Playwright browser inside app path
RUN npx playwright install chromium

COPY . .

EXPOSE 3000

CMD ["npm", "start"]