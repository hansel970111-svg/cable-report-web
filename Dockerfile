FROM python:3.12.13-slim-bookworm@sha256:8a7e7cc04fd3e2bd787f7f24e22d5d119aa590d429b50c95dfe12b3abe52f48b AS python-runtime

FROM node:24.14.0-bookworm@sha256:5a593d74b632d1c6f816457477b6819760e13624455d587eef0fa418c8d0777b

WORKDIR /app

COPY --from=python-runtime /usr/local /usr/local

RUN corepack enable \
  && corepack prepare pnpm@9.15.9 --activate

COPY package.json pnpm-lock.yaml .npmrc ./
COPY vendor/xlsx-0.20.3.tgz ./vendor/xlsx-0.20.3.tgz
RUN corepack pnpm install --frozen-lockfile

COPY requirements.lock ./
RUN python3 -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir --require-hashes --only-binary=:all: -r requirements.lock

ENV PATH="/opt/venv/bin:${PATH}"

COPY . .

RUN corepack pnpm build

ENV COZE_PROJECT_ENV=PROD
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=10000

EXPOSE 10000

CMD ["node", "scripts/start.mjs"]
