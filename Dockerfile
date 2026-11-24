# syntax=docker/dockerfile:1
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock* ./
# Tekrarlanabilir kurulum için bun.lock repoya eklidir; üretimde: bun install --frozen-lockfile --production
ARG NPM_REGISTRY=
RUN if [ -n "$NPM_REGISTRY" ]; then bun install --production --registry "$NPM_REGISTRY"; else bun install --production; fi

FROM oven/bun:1-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/app/data
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY db ./db
# NOT: data/ imaja KOPYALANMAZ. REPOSITORY_DRIVER=postgis iken api'nin dosyaya ihtiyacı yoktur;
# importer servisi ./data klasörünü /app/data olarak bağlar (docker-compose.yml).
USER bun
EXPOSE 3000
# /health/ready: veri belleğe yüklenince (veya PostGIS doğrulanınca) 200 döner.
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "src/index.ts"]
