FROM node:22-bookworm-slim AS frontend-build

WORKDIR /build/frontend
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm test \
    && pnpm build \
    && pnpm verify:cloud-policy

FROM node:22-bookworm-slim AS node-runtime

FROM python:3.13-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080 \
    CTC_GATEWAY_PORT=8765 \
    CTC_PYTHON_EXECUTABLE=python3

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && node --version \
    && groupadd --gid 10001 ctc \
    && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin ctc

COPY frontend/deploy/requirements-gateway.txt /tmp/requirements-gateway.txt
RUN pip install --no-cache-dir --requirement /tmp/requirements-gateway.txt \
    && python3 -c "import fsspec, gcsfs, numpy, pandas, pyarrow, xarray, zarr" \
    && rm /tmp/requirements-gateway.txt

WORKDIR /app
COPY backend/ /app/backend/
COPY frontend/scripts/ /app/frontend/scripts/
COPY --from=frontend-build /build/frontend/dist/ /app/frontend/dist/

RUN chown -R 10001:10001 /app
USER 10001:10001
WORKDIR /app/frontend

EXPOSE 8080
CMD ["node", "scripts/start-release-candidate-server.mjs"]
