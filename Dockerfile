# =========================
# Build Stage
# =========================
FROM focker.ir/node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./

# استفاده از میرور npm ایران
RUN npm config set registry https://npm.iranrepo.ir/ \
    && npm install

COPY . .

RUN npm run build

# =========================
# Production Stage
# =========================
FROM focker.ir/node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./

RUN npm config set registry https://npm.iranrepo.ir/ \
    && npm install --omit=dev \
    && npm cache clean --force

COPY --from=builder /app/dist ./dist

# اگر داری
# COPY --from=builder /app/uploads ./uploads
# COPY --from=builder /app/public ./public

EXPOSE 3000

CMD ["npm", "start"]