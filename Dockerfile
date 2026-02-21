FROM node:25-alpine

RUN apk add --no-cache dumb-init bash curl python3 make g++ \
    && npm install -g @google/gemini-cli

WORKDIR /app

ENV NODE_ENV=production

COPY --chown=node:node package*.json ./

RUN npm ci --omit=dev

COPY --chown=node:node src/ ./src/
COPY --chown=node:node SYSTEM_PROMPT.md ./

RUN mkdir -p /home/node/.gemini && chown -R node:node /home/node/.gemini
COPY --chown=node:node settings.json /home/node/.gemini/settings.json

USER node

ENTRYPOINT ["/usr/bin/dumb-init", "--"]

CMD ["node", "src/index.mjs"]
