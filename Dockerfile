FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache curl

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm config set registry https://registry.npmjs.org && npm ci

FROM deps AS build
COPY tsconfig.json vitest.config.ts ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY package.json ./package.json

EXPOSE 6688
CMD ["node", "dist/index.js"]
