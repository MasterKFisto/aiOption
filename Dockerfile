# Docker-only development container.
#
# The host machine has no Node.js, npm, or pnpm installed, so the entire
# toolchain lives inside this image. Rebuild with:
#   docker compose build dev
FROM node:22-slim

# Pin the pnpm version so every environment is reproducible
# (must match `packageManager` in package.json).
ARG PNPM_VERSION=12.8.1

# Install pnpm globally (npm ships with the node image).
RUN npm install --global pnpm@${PNPM_VERSION} \
    && pnpm --version

WORKDIR /app

# Keep the container alive. All work happens via `docker compose exec dev ...`.
CMD ["tail", "-f", "/dev/null"]
