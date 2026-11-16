# One image, one Render web service, three bots.
#   /chess  Node + Telegram bot      (apps/chess)
#   /ludo   Node + Telegram bot      (apps/ludo)
#   /uno    Python 3.14 Telegram bot (apps/uno)
# The gateway in gateway/ is the only process Render talks to.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# Node 22 comes from the base image. Python is not in Debian bookworm, so uv downloads a
# standalone build. UNO supports Python 3.10 to 3.14; 3.14.6 is the tested default.
ARG PYTHON_VERSION=3.14.6
COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /usr/local/bin/uv
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV UV_PYTHON_INSTALL_DIR=/opt/python \
    UV_LINK_MODE=copy

WORKDIR /app

# ---- UNO (Python) -------------------------------------------------------------------
COPY apps/uno/requirements.txt /app/apps/uno/requirements.txt
RUN uv python install --no-bin ${PYTHON_VERSION} \
 && uv venv --python ${PYTHON_VERSION} /opt/venv \
 && uv pip install --python /opt/venv/bin/python --no-cache -r /app/apps/uno/requirements.txt
ENV PATH="/opt/venv/bin:${PATH}"

COPY apps/uno /app/apps/uno

# ---- Chess (Node) -------------------------------------------------------------------
COPY apps/chess/package.json apps/chess/package-lock.json /app/apps/chess/
RUN cd /app/apps/chess && npm ci --no-audit --no-fund

COPY apps/chess /app/apps/chess
ARG CHESS_BOT_USERNAME=""
ARG CHESS_MINIAPP_SHORT_NAME="Chess"
RUN cd /app/apps/chess \
 && APP_BASE=/chess \
    VITE_BOT_USERNAME="${CHESS_BOT_USERNAME}" \
    VITE_MINIAPP_SHORT_NAME="${CHESS_MINIAPP_SHORT_NAME}" \
    npm run build

# ---- Ludo (Node) --------------------------------------------------------------------
COPY apps/ludo/package.json apps/ludo/package-lock.json /app/apps/ludo/
RUN cd /app/apps/ludo && npm ci --no-audit --no-fund

COPY apps/ludo /app/apps/ludo
ARG LUDO_BOT_USERNAME=""
ARG LUDO_MINIAPP_SHORT_NAME="ludo"
RUN cd /app/apps/ludo \
 && APP_BASE=/ludo \
    VITE_BOT_USERNAME="${LUDO_BOT_USERNAME}" \
    VITE_MINIAPP_SHORT="${LUDO_MINIAPP_SHORT_NAME}" \
    npm run build

# ---- Hub -----------------------------------------------------------------------------
COPY gateway /app/gateway
RUN mkdir -p /app/data

ENV PYTHON=/opt/venv/bin/python
EXPOSE 10000
WORKDIR /app
CMD ["node", "gateway/gateway.mjs"]
