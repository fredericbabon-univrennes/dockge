############################################
# Dockge Full Build - with add-user script
# Recompiles frontend + backend from source
# Includes all recent changes:
# - extra/add-user.ts (ajouté)
# - package.json (modifié)
# - backend/socket-handlers/main-socket-handler.ts (modifié)
# - frontend/src/pages/Compose.vue (modifié - logs added)
# - frontend/src/components/Container.vue (modifié - logs added)
############################################

FROM louislam/dockge:base AS build

WORKDIR /app

# Copy all source files
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node tsconfig.json ./
COPY --chown=node:node frontend ./frontend
COPY --chown=node:node backend ./backend
COPY --chown=node:node common ./common
COPY --chown=node:node extra ./extra

# Install dependencies
RUN npm ci

# Build frontend (this will compile Vue files)
RUN npm run build:frontend

############################################
# Release Stage
############################################
FROM louislam/dockge:base AS release

WORKDIR /app

# Copy compiled frontend and dependencies from build stage
COPY --from=build /app/frontend-dist ./frontend-dist
COPY --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/backend ./backend
COPY --chown=node:node --from=build /app/common ./common
COPY --chown=node:node --from=build /app/extra ./extra
COPY --chown=node:node package.json ./

# Install htop-gpu from source (Python-based)
RUN apt-get update && apt-get install -y \
    git \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/* \
    && git clone --depth 1 https://github.com/seongwon980/htop-gpu.git /tmp/htop-gpu \
    && cd /tmp/htop-gpu \
    && pip3 install --break-system-packages . \
    && cd / \
    && rm -rf /tmp/htop-gpu \
    && apt-get remove -y git \
    && apt-get autoremove -y

# Create data directory
RUN mkdir ./data

# Environment setup
ENV UV_USE_IO_URING=0

VOLUME /app/data
EXPOSE 5001

HEALTHCHECK --interval=60s --timeout=30s --start-period=60s --retries=5 CMD extra/healthcheck

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["tsx", "./backend/index.ts"]
