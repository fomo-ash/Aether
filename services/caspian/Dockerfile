FROM node:20-slim
RUN apt-get update -y && apt-get install -y openssl

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy the entire workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY services/caspian ./services/caspian

# Install dependencies and build
RUN pnpm install
RUN pnpm --filter @flowpilot/database generate
RUN pnpm --filter @aether/caspian... build

# Run the caspian service
WORKDIR /app/services/caspian
CMD ["pnpm", "start"]
