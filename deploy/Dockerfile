# syntax=docker/dockerfile:1
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 kisiauthong contributors
#
# Server and web UI in one small image. Build from the repository root:
#   docker build -f deploy/Dockerfile -t kisiauthong .
# Data lives in the /data volume; the server listens on port 8080.

ARG GO_VERSION=1.26

# Go cross-compiles for the target, so multi-platform builds need no emulation
FROM --platform=$BUILDPLATFORM golang:${GO_VERSION}-alpine AS build
WORKDIR /src/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
COPY web/ ./web/
ARG TARGETOS TARGETARCH TARGETVARIANT
# version (no "v" prefix), full commit hash and UTC build time, shown in Settings → About (ADR 0018)
ARG VERSION=dev COMMIT= BUILD_TIME=
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH GOARM=${TARGETVARIANT#v} \
    go build -trimpath -tags embedweb \
      -ldflags "-s -w -X main.appVersion=${VERSION} -X main.commit=${COMMIT} -X main.buildTime=${BUILD_TIME}" \
      -o /out/kisiauthong . \
 && mkdir -p /out/data

# no shell, no package manager; runs as an unprivileged user (uid 65532)
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/kisiauthong /kisiauthong
COPY --from=build --chown=65532:65532 /out/data /data
ENV KISIAUTHONG_HOST=0.0.0.0 \
    PORT=8080 \
    KISIAUTHONG_DB=/data/kisiauthong.db
VOLUME /data
EXPOSE 8080
USER 65532:65532
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["/kisiauthong", "healthcheck"]
ENTRYPOINT ["/kisiauthong"]
