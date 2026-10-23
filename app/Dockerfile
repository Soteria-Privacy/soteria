# --- build stage: full node image has the toolchain for native deps (usb) ---
FROM node:20-bookworm AS build
WORKDIR /app

# Vite inlines VITE_* at build time. Railway passes service variables as build
# args, so declare them here and promote to ENV before `npm run build`.
ARG VITE_SOLANA_CLUSTER=mainnet-beta
ARG VITE_SOLANA_RPC
ARG VITE_SOTERIA_SERVER
ARG VITE_SOTERIA_POOL_ID
ARG VITE_SOTERIA_SHIELDED_ID
ARG VITE_SOTERIA_EXTERNAL_NULLIFIER
ARG VITE_SOTERIA_GROUP_ID
ARG VITE_SOTERIA_PROGRAM_ID
ENV VITE_SOLANA_CLUSTER=$VITE_SOLANA_CLUSTER \
    VITE_SOLANA_RPC=$VITE_SOLANA_RPC \
    VITE_SOTERIA_SERVER=$VITE_SOTERIA_SERVER \
    VITE_SOTERIA_POOL_ID=$VITE_SOTERIA_POOL_ID \
    VITE_SOTERIA_SHIELDED_ID=$VITE_SOTERIA_SHIELDED_ID \
    VITE_SOTERIA_EXTERNAL_NULLIFIER=$VITE_SOTERIA_EXTERNAL_NULLIFIER \
    VITE_SOTERIA_GROUP_ID=$VITE_SOTERIA_GROUP_ID \
    VITE_SOTERIA_PROGRAM_ID=$VITE_SOTERIA_PROGRAM_ID

COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

# --- serve stage: static SPA via `serve`, listening on Railway's $PORT ---
FROM node:20-bookworm-slim
WORKDIR /app
RUN npm install -g serve@14
COPY --from=build /app/dist ./dist
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "serve -s dist -l ${PORT}"]
