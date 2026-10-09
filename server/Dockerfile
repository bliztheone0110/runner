FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY server ./server
RUN npm run build:api

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/migrations ./server/dist/server/migrations
EXPOSE 3001
CMD ["node", "server/dist/server/src/index.js"]
