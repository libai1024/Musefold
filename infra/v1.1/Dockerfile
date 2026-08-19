FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
COPY shared ./shared
COPY scripts ./scripts
COPY website ./website
COPY generated ./generated
COPY docs ./docs
COPY tsconfig*.json ./

RUN npm ci --ignore-scripts
RUN npm run build:web

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=60160

EXPOSE 60160

CMD ["npm", "run", "start", "--workspace", "@musefold/web-api"]
