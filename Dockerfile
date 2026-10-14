# Brew prototype (feed.joinsquareup.com). Chromium is here for the reader's checkout walk and the move PDFs.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg chromium fonts-liberation fonts-noto-core fonts-noto-color-emoji ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV CHROME_PATH=/usr/bin/chromium PUPPETEER_SKIP_DOWNLOAD=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
# every server module at the root (no hand-kept list to forget), plus the folders the runtime reads
COPY *.js ./
COPY reader ./reader
COPY connectors ./connectors
COPY dummy ./dummy
COPY pdf ./pdf
COPY skills ./skills
COPY prompts ./prompts
COPY data ./data
COPY sources/moves ./sources/moves
COPY public ./public
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
