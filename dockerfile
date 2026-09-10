FROM mcr.microsoft.com/playwright:v1.55.0-jammy

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Install all browsers and required system dependencies
RUN npx playwright install --with-deps

EXPOSE 3000

CMD ["npm", "start"]