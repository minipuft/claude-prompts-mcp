FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install all dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the TypeScript project
RUN npm run build

# Remove dev dependencies to reduce image size
RUN npm ci --only=production && npm cache clean --force

# Set environment variables
ENV NODE_ENV=production
ENV MCP_SERVER_ROOT=/app

# Expose port
EXPOSE 8000

# Start the server
CMD ["node", "dist/index.js", "--transport=stdio", "--quiet"]