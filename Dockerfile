FROM python:3.12-alpine

RUN pip install --no-cache-dir pillow pillow-heif \
    && addgroup -g 1000 -S rekall \
    && adduser -u 1000 -S rekall -G rekall

WORKDIR /app
COPY . /app
RUN chown -R rekall:rekall /app

USER rekall:rekall
CMD ["python", "/app/server.py"]

