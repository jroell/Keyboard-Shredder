FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates ffmpeg git libsndfile1 python3-venv \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/uv && /opt/uv/bin/pip install --no-cache-dir uv==0.11.7
ENV PATH="/opt/uv/bin:$PATH" UV_PYTHON_DOWNLOADS=never
COPY package.json package-lock.json ./
RUN npm ci
COPY analysis/pyproject.toml analysis/uv.lock analysis/setup.mjs ./analysis/
RUN UV_NO_CACHE=1 npm run setup:analysis
COPY index.html server.ts tsconfig.json vite.config.ts ./
COPY analysis/ ./analysis/
COPY backend/ ./backend/
COPY shared/ ./shared/
COPY src/ ./src/
COPY catalog/ ./catalog/
RUN npm run build && mkdir -p /app/data && chown node:node /app/data
ENV NODE_ENV=production PORT=3000 SONG_DATA_DIR=/app/data
USER node
EXPOSE 3000
CMD ["node", "--import", "tsx", "server.ts"]
