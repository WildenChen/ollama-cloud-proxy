FROM oven/bun:1.1.42-slim

WORKDIR /app

COPY package.json tsconfig.json ./
COPY src ./src
COPY public ./public

RUN mkdir -p /data

EXPOSE 11435

HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD bun -e "const r=await fetch('http://127.0.0.1:11435/health'); if(!r.ok) process.exit(1)"

CMD ["bun", "run", "src/index.ts"]
