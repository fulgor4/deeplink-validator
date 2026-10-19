# Hops API for the Deeplink Checker. Build from this folder:  docker build -t deeplink-hops server/
# Run:  docker run -p 8080:8080 -e ALLOWED_ORIGINS=https://your-page.example deeplink-hops
FROM node:22-bookworm-slim

# Chromium runs JavaScript-only redirect pages; fonts keep pages from failing on missing glyphs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-liberation ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --chown=10000:10000 package.json server.mjs trace.mjs headless.mjs ./

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    CHROME_PATH=/usr/bin/chromium \
    HOME=/tmp \
    TRUST_PROXY=1

# Non-root (required by most container platforms, including WCNP).
USER 10000
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
