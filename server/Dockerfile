# Backend image, built from the monorepo root (context: .). Only the server and
# sdk workspaces are installed so the app's native deps (Ledger -> usb) are
# never compiled.
FROM node:20-bookworm-slim
WORKDIR /repo

COPY package.json package-lock.json tsconfig.json ./
COPY packages/sdk ./packages/sdk
COPY server ./server

RUN npm install --include-workspace-root --include=dev -w server -w packages/sdk \
  && npm run build:sdk \
  && npm -w server run build

ENV NODE_ENV=production HOST=0.0.0.0
CMD ["sh", "-c", "npm -w server run migrate:prod && npm -w server start"]
