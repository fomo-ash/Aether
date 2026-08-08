FROM node:20-alpine

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace configuration
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY services/api ./services/api

# Install dependencies and build
RUN pnpm install
RUN pnpm --filter @aether/api build

# Set directory to API
WORKDIR /app/services/api

EXPOSE 3250
CMD ["pnpm", "start"]
