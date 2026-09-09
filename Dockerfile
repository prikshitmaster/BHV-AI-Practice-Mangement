FROM node:24-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Placeholder only — `prisma generate` needs the variable defined but never
# connects. The real URL is injected at runtime by docker-compose.
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npx prisma generate
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
