FROM node:20.7.0-alpine AS base

WORKDIR /app

COPY package*.json ./
COPY services ./services

RUN apk add --no-cache bash
RUN npm install -g nodemon
RUN npm install -g serverless@3
RUN npm install --ignore-scripts
RUN npm run install:windows
EXPOSE 4001-4016

# --- dev stage, assumes already built ---
FROM base AS dev
CMD ["node", "index.js"]

# --- prod stage, full copy ---
FROM base AS prod
COPY . .
CMD ["node", "index.js"]
