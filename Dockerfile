FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY package.json ./
COPY server.js ./
COPY lib ./lib
COPY data ./data
COPY public ./public
COPY editor ./editor
RUN mkdir -p /app/stats /app/versions && chown node:node /app/stats /app/versions
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server.js"]
