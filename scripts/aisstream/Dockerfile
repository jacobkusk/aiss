FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY collector.py .

# Secrets are injected at runtime via Fly/Railway env:
#   AISSTREAM_API_KEY, SUPABASE_ANON_KEY, (optional INGEST_API_KEY, AISSTREAM_BBOX)
ENV PYTHONUNBUFFERED=1
CMD ["python", "-u", "collector.py"]
