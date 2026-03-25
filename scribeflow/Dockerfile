FROM node:20-alpine

LABEL maintainer="ScribeFlow"
LABEL description="Self-hosted writing application"

# Create app directory
WORKDIR /app

# Install dependencies (cached layer — only reruns if package.json changes)
COPY backend/package*.json ./
RUN npm install --production

# Copy application files
COPY backend/ ./
COPY frontend/ ../frontend/

# Ensure the Bible data directory exists so the route doesn't error on startup
# The actual JSON files are populated later by running the bible-fetcher service
RUN mkdir -p /app/data/bibles

# Declare /data as a volume (project files — separate from image)
VOLUME ["/data"]

EXPOSE 3051

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3051/api/health || exit 1

ENV PORT=3051
ENV DATA_DIR=/data
ENV NODE_ENV=production

CMD ["node", "server.js"]
