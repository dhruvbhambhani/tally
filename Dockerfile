# Tally, self-hosted.
#   docker build -t tally .
#   docker run -p 3000:3000 -v tally-data:/data tally
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production TALLY_DATA_DIR=/data PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app ./
RUN mkdir -p /data && chown -R node:node /data /app/.next
USER node
VOLUME /data
EXPOSE 3000
CMD ["npm", "start"]
