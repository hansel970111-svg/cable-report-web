FROM node:20-bookworm

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

COPY package.json pnpm-lock.yaml .npmrc ./
RUN corepack pnpm install --frozen-lockfile=false

COPY requirements.txt ./
RUN python3 -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt

ENV PATH="/opt/venv/bin:${PATH}"

COPY . .

RUN corepack pnpm build

ENV COZE_PROJECT_ENV=PROD
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=10000

EXPOSE 10000

CMD ["node", "scripts/start.mjs"]
