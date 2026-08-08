FROM node:20-alpine

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy the entire workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY services/worker ./services/worker

# Install dependencies and build
RUN pnpm install
RUN pnpm --filter @flowpilot/database generate
RUN pnpm --filter @aether/worker... build

# Set directory to worker
WORKDIR /app/services/worker

CMD ["pnpm", "start"]
