FROM node:25-alpine AS builder

ARG AGENT_PROVIDER=gemini

RUN apk add --no-cache python3 make g++

RUN if [ "$AGENT_PROVIDER" = "gemini" ]; then \
    npm install -g @google/gemini-cli; \
    elif [ "$AGENT_PROVIDER" = "claude_code" ]; then \
    npm install -g @anthropic-ai/claude-code@2.1.50; \
    elif [ "$AGENT_PROVIDER" = "openai_codex" ]; then \
    npm install -g @openai/codex@0.104.0; \
    fi \
    && npm cache clean --force

RUN find /usr/local/lib/node_modules -type d \( \
    -name "test" -o -name "tests" -o -name "__tests__" \
    -o -name "docs" -o -name "doc" -o -name "example" -o -name "examples" \
    -o -name ".github" -o -name ".vscode" \
    \) \
    -not -path "*/codex-linux-*" \
    -not -path "*/codex-darwin-*" \
    -not -path "*/codex-win32-*" \
    -prune -exec rm -rf {} + 2>/dev/null; \
    find /usr/local/lib/node_modules -type f \( \
    -name "*.map" -o -name "*.md" -o -name "*.markdown" \
    -o -name "CHANGELOG*" -o -name "CHANGES*" -o -name "HISTORY*" \
    -o -name "LICENSE*" -o -name "LICENCE*" -o -name "NOTICE*" \
    -o -name "AUTHORS*" -o -name "CONTRIBUTORS*" \
    -o -name ".npmignore" -o -name ".eslintrc*" -o -name ".prettierrc*" \
    -o -name ".editorconfig" -o -name ".travis.yml" -o -name ".babelrc" \
    -o -name "tsconfig.json" -o -name "tslint.json" \
    -o -name "Makefile" -o -name "Gruntfile*" -o -name "Gulpfile*" \
    \) -delete 2>/dev/null; \
    find /usr/local/lib/node_modules -type d -empty -delete 2>/dev/null; \
    true

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./

RUN npm ci --omit=dev \
    && npm cache clean --force

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

COPY --chown=node:node src/ ./src/
COPY --chown=node:node bin/ ./bin/
COPY --chown=node:node SYSTEM_PROMPT.md ./

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

COPY --chown=node:node settings.json /tmp/settings.json
RUN if [ "$AGENT_PROVIDER" = "gemini" ]; then \
    cp /tmp/settings.json /home/node/.gemini/settings.json; \
    fi \
    && rm -f /tmp/settings.json

USER node

ENTRYPOINT ["/usr/bin/dumb-init", "--"]

CMD ["bash", "bin/start.sh"]
