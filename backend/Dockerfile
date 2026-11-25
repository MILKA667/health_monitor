FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY requirments.txt .
RUN pip install --no-cache-dir -r requirments.txt

COPY . .
RUN chmod +x docker-entrypoint.sh && useradd --no-create-home app
USER app

EXPOSE 5000
ENTRYPOINT ["./docker-entrypoint.sh"]
