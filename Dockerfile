FROM node:25-alpine AS builder

ARG AGENT_PROVIDER=gemini

RUN apk add --no-cache python3 make g++

RUN --mount=type=cache,target=/root/.npm \
    if [ "$AGENT_PROVIDER" = "gemini" ]; then \
    npm install -g @google/gemini-cli; \
    elif [ "$AGENT_PROVIDER" = "claude_code" ]; then \
    npm install -g @anthropic-ai/claude-code@2.1.50; \
    elif [ "$AGENT_PROVIDER" = "openai_codex" ]; then \
    npm install -g @openai/codex@0.104.0; \
    fi

# Safely remove only large source maps to save space
RUN find /usr/local/lib/node_modules -type f -name "*.map" -delete 2>/dev/null || true

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./

RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

FROM node:25-alpine

ARG AGENT_PROVIDER=gemini

RUN apk add --no-cache dumb-init bash curl \
    && if [ "$AGENT_PROVIDER" = "claude_code" ]; then \
    apk add --no-cache dbus gnome-keyring libsecret; \
    fi

COPY --from=builder /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=builder /usr/local/bin/ /usr/local/bin/

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules/

EXPOSE 3100

RUN mkdir -p /app/playground /app/data \
    && if [ "$AGENT_PROVIDER" = "gemini" ]; then \
    mkdir -p /home/node/.gemini && chown -R node:node /home/node/.gemini; \
    elif [ "$AGENT_PROVIDER" = "openai_codex" ]; then \
    mkdir -p /home/node/.codex && chown -R node:node /home/node/.codex; \
    elif [ "$AGENT_PROVIDER" = "claude_code" ]; then \
    mkdir -p /home/node/.claude && chown -R node:node /home/node/.claude; \
    fi \
    && chown -R node:node /app/playground /app/data

COPY --chown=node:node settings.json trustedFolders.json /tmp/
RUN if [ "$AGENT_PROVIDER" = "gemini" ]; then \
    cp /tmp/settings.json /home/node/.gemini/settings.json \
    && cp /tmp/trustedFolders.json /home/node/.gemini/trustedFolders.json; \
    fi \
    && rm -f /tmp/settings.json /tmp/trustedFolders.json

COPY --chown=node:node src/ ./src/
COPY --chown=node:node bin/ ./bin/
COPY --chown=node:node SYSTEM_PROMPT.md ./

USER node

ENTRYPOINT ["/usr/bin/dumb-init", "--"]

CMD ["bash", "bin/start.sh"]
