# ON THE BEAT — the relay and the app it serves, as one always-on machine
# (fly.toml). The first stage turns app/ into dist/; the machine that runs
# keeps only the relay, dist/ and the relay's runtime install.

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# jsqr installs from the tarball kept here, so it comes before npm ci.
COPY vendor ./vendor
RUN npm ci
COPY vite.config.js ./
COPY app ./app
# The app takes the pairing code's letters from relay/band.js.
COPY relay ./relay
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci --omit=dev
COPY relay ./relay
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "relay/server.js"]
