FROM node:20-alpine

LABEL maintainer="ScribeFlow"
LABEL description="Self-hosted writing application with offline Bible support"

# Install ca-certificates for HTTPS during Bible data fetch
RUN apk add --no-cache ca-certificates

# Create app directory
WORKDIR /app

# Copy backend package files and install dependencies first
# (separate layer so npm install is cached unless package.json changes)
COPY backend/package*.json ./
RUN npm install --production

# Copy application files
COPY backend/ ./
COPY frontend/ ../frontend/

# ── FETCH BIBLE DATA ──────────────────────────────────────────────────────
# Downloads 6 public-domain translations (~25 MB total) at build time so
# the Bible pane works fully offline at runtime with no external API calls.
# Data is baked into the image layer in /app/data/bibles/.
# If network is unavailable at build time, server starts normally and the
# Bible pane shows a one-time setup notice.
RUN node scripts/fetch-bibles.js || echo "[WARN] Bible data fetch skipped"

# Declare /data as a volume (project files live here, separate from image)
VOLUME ["/data"]

# Expose port
EXPOSE 3051

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3051/api/health || exit 1

# Environment defaults
ENV PORT=3051
ENV DATA_DIR=/data
ENV NODE_ENV=production

# Start server
CMD ["node", "server.js"]
