FROM node:24-alpine AS builder

RUN apk add --no-cache git

WORKDIR /app

# `pnpm-workspace.yaml` carries the dependency overrides the lockfile records,
# so a frozen install without it fails with ERR_PNPM_LOCKFILE_CONFIG_MISMATCH.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN corepack enable pnpm
RUN pnpm install --frozen-lockfile

COPY . .

ENV NX_DAEMON=false

ARG TARGET

RUN pnpm exec nx build ${TARGET} --verbose

RUN mkdir -p /tmp/runtime && \
  if [ "${TARGET}" = "client" ]; then \
    cp -r apps/client/.next/standalone/* /tmp/runtime/ && \
    mkdir -p /tmp/runtime/apps/client/.next && \
    cp -r apps/client/.next/static /tmp/runtime/apps/client/.next/static && \
    cp -r apps/client/public /tmp/runtime/apps/client/public; \
  else \
    cp -r dist/apps/${TARGET}/* /tmp/runtime/ && \
    cp -r node_modules /tmp/runtime/node_modules && \
    mkdir -p /tmp/runtime/apps/api/tools /tmp/runtime/apps/api/src/app && \
    cp apps/api/tools/reset-demo-data.ts /tmp/runtime/apps/api/tools/reset-demo-data.ts && \
    cp apps/api/src/app/api-simulation-members.ts /tmp/runtime/apps/api/src/app/api-simulation-members.ts && \
    cp apps/api/src/app/api-test-member-schema.ts /tmp/runtime/apps/api/src/app/api-test-member-schema.ts && \
    mkdir -p /tmp/runtime/libs/bpm-core/src/lib && \
    cp -r libs/bpm-core/src/lib/database /tmp/runtime/libs/bpm-core/src/lib/database && \
    cp -r libs/bpm-core/src/lib/migrations /tmp/runtime/libs/bpm-core/src/lib/migrations && \
    cp package.json pnpm-lock.yaml tsconfig.base.json /tmp/runtime/; \
  fi

FROM node:24-alpine

WORKDIR /app

RUN apk add --no-cache git
RUN corepack enable pnpm

ARG TARGET
ENV APP_TARGET=${TARGET}
ENV NODE_ENV=production
ENV PORT=80
ENV TZ=Asia/Taipei

COPY --from=builder /tmp/runtime ./

EXPOSE 80

CMD ["sh", "-c", "if [ \"$APP_TARGET\" = \"client\" ]; then node apps/client/server.js; else node main.js; fi"]
