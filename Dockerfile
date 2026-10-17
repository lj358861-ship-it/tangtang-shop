FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.js ./
COPY lib ./lib
COPY data/seed-products.json ./data/seed-products.json
COPY public ./public
# Attach a Railway Volume (mount path /data) so the SQLite DB, uploads and payment proofs survive deploys.
ENV DATA_DIR=/data
EXPOSE 3000
CMD ["node", "server.js"]
