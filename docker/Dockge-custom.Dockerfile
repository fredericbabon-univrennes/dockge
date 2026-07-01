############################################
# Dockge Custom - with add-user script
# Base: louislam/dockge:1
############################################
FROM louislam/dockge:1

WORKDIR /app

# Copy modified files
# 1. Updated package.json with add-user npm script
COPY --chown=node:node package.json /app/package.json

# 2. Updated socket handler with refreshNeedSetup event
COPY --chown=node:node backend/socket-handlers/main-socket-handler.ts /app/backend/socket-handlers/main-socket-handler.ts

# 3. New add-user script
COPY --chown=node:node extra/add-user.ts /app/extra/add-user.ts

# 4. Updated dockge-server.ts with "/api/login"
COPY --chown=node:node backend/dockge-server.ts /app/backend/dockge-server.ts

# Run as node user (already set in base image)
USER node
