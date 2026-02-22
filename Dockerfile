FROM node:25-alpine

RUN apk add --no-cache dumb-init bash curl python3 make g++ \
    && npm install -g @google/gemini-cli @openai/codex@0.104.0

WORKDIR /app

ENV NODE_ENV=production

COPY --chown=node:node package*.json ./

RUN npm ci --omit=dev

COPY --chown=node:node src/ ./src/
COPY --chown=node:node SYSTEM_PROMPT.md ./

RUN mkdir -p /home/node/.gemini && chown -R node:node /home/node/.gemini
COPY --chown=node:node settings.json /home/node/.gemini/settings.json

RUN mkdir -p /home/node/.codex && chown -R node:node /home/node/.codex

USER node

ENTRYPOINT ["/usr/bin/dumb-init", "--"]

CMD ["node", "src/index.mjs"]
