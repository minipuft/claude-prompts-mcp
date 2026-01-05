# Stage 1: Builder
FROM node:24-alpine AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Stage 2: Production Runtime
FROM node:24-alpine

# Set working directory
WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV MCP_WORKSPACE=/app
ENV PORT=9090

# Install production dependencies only
COPY package*.json ./
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prompts ./prompts
COPY --from=builder /app/methodologies ./methodologies
COPY --from=builder /app/gates ./gates
COPY --from=builder /app/styles ./styles
# Copy config and potentially other static assets if needed
COPY --from=builder /app/config.json ./config.json

# Create logs and runtime-state directories with correct permissions
RUN mkdir -p logs runtime-state && chown -R node:node logs runtime-state dist prompts methodologies gates styles config.json

# Security: Run as non-root user
USER node

# Expose the SSE port
EXPOSE 9090

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:9090/sse || exit 1

# Start the server in SSE mode by default
CMD ["node", "dist/index.js", "--transport=sse", "--quiet"]
