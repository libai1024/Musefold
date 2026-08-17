FROM python:3.13-alpine@sha256:540c7d91f98ff6880174c40e99067bf5941eb54d818a7a5e094d188b196a934d

RUN addgroup -g 10001 musefold \
    && adduser -D -H -u 10001 -G musefold musefold \
    && mkdir -p /app /data \
    && chown -R musefold:musefold /app /data

WORKDIR /app
COPY --chown=musefold:musefold server.py catalog.json ./

USER musefold
ENV PYTHONUNBUFFERED=1 \
    DOWNLOAD_DB_PATH=/data/downloads.sqlite3 \
    DOWNLOAD_CATALOG_PATH=/app/catalog.json

EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=2)"

CMD ["python", "server.py"]
