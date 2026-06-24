# Worker DjViral — FastAPI + librosa + FFmpeg. Pensado para a Railway.
FROM python:3.11-slim

# FFmpeg é necessário para o librosa decodificar mp4 e para o clipper cortar.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Railway injeta $PORT. Default 8000 para rodar local.
ENV PORT=8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
