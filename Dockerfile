# syntax=docker/dockerfile:1.6

FROM node:20-alpine AS frontend-build
WORKDIR /app
# Install rsvg-convert for icon generation
RUN apk add --no-cache rsvg-convert
# Copy assets and generate-icons script first
COPY assets/ assets/
COPY generate-icons.sh ./
RUN chmod +x generate-icons.sh && /bin/sh ./generate-icons.sh
# Now build frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM golang:1.21-alpine AS server-build
WORKDIR /app/server
RUN apk add --no-cache git
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./

ARG BUILD_TIME
ARG VERSION
ARG COMMIT
ARG TARGETOS
ARG TARGETARCH

ENV CGO_ENABLED=0
RUN GOOS="${TARGETOS:-linux}" GOARCH="${TARGETARCH:-amd64}" \
  go build -ldflags "-X 'main.BuildTime=${BUILD_TIME}' -X 'main.Version=${VERSION}' -X 'main.Commit=${COMMIT}'" \
  -o /app/xxtcloudserver .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates \
  && addgroup -S app \
  && adduser -S -G app -u 10001 app
WORKDIR /app
RUN mkdir -p /app/frontend /app/data
COPY --from=server-build /app/xxtcloudserver /app/xxtcloudserver
COPY --from=frontend-build /app/frontend/dist /app/frontend
RUN chown -R app:app /app
USER app

EXPOSE 46980 43478/tcp 43478/udp
ENTRYPOINT ["./xxtcloudserver"]
