FROM node:20-alpine

LABEL maintainer="ScribeFlow"
LABEL description="Self-hosted writing application"

# Create app directory
WORKDIR /app

# Copy backend package files and install dependencies first
# (separate layer so npm install is cached unless package.json changes)
COPY backend/package*.json ./
RUN npm install --production

# Copy application files
COPY backend/ ./
COPY frontend/ ../frontend/

# Declare /data as a volume mount point.
# This does NOT create data inside the image — it signals to Docker that
# /data should be provided by a volume at runtime, keeping project files
# completely separate from the container image.
VOLUME ["/data"]

# Expose port
EXPOSE 3051

# Health check (uses correct port 3051)
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3051/api/health || exit 1

# Environment defaults (overridden by docker-compose environment section)
ENV PORT=3051
ENV DATA_DIR=/data
ENV NODE_ENV=production

# Start server — startup scan runs before the HTTP listener binds
CMD ["node", "server.js"]
