FROM oven/bun:1.3.14

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY LICENSE package.json ./
COPY src ./src

RUN mkdir -p /data /data/imports \
  && chown -R bun:bun /app /data

ENV BITTERGIT_HOST=0.0.0.0
ENV BITTERGIT_PORT=7420
ENV BITTERGIT_DATA_ROOT=/data

EXPOSE 7420
VOLUME ["/data"]

USER bun

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["bun", "-e", "const port = process.env.BITTERGIT_PORT ?? '7420'; const response = await fetch(`http://127.0.0.1:${port}/up`); if (!response.ok) process.exit(1)"]

CMD ["bun", "run", "src/server.ts"]
