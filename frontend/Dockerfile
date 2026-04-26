FROM node:20-alpine

# `curl` is needed to fetch Poly Haven CC0 textures at build time.
RUN apk add --no-cache curl

WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund --loglevel=error

COPY . .

# Fetch PBR textures once at build time. They live under public/textures/
# and are served by Next.js as static assets. Cached by Docker layer.
RUN sh scripts/fetch-textures.sh

EXPOSE 3000

CMD ["npm", "run", "dev"]
