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

# Build htop-gpu for GPU monitoring
RUN apt-get update && apt-get install -y \
    git \
    build-essential \
    libncursesw5-dev \
    && git clone https://github.com/Mikay/htop-gpu.git /tmp/htop-gpu \
    && cd /tmp/htop-gpu \
    && ./configure \
    && make \
    && make install \
    && cd / \
    && rm -rf /tmp/htop-gpu

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

# Copy htop-gpu binary from build stage
COPY --from=build /usr/local/bin/htop-gpu /usr/local/bin/htop-gpu

# Create data directory
RUN mkdir ./data

# Environment setup
ENV UV_USE_IO_URING=0

VOLUME /app/data
EXPOSE 5001

HEALTHCHECK --interval=60s --timeout=30s --start-period=60s --retries=5 CMD extra/healthcheck

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["tsx", "./backend/index.ts"]
