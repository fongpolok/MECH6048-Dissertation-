FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Ollama is NOT installed here — it runs as its own service (see docker-compose.yml)
# and this container talks to it over the network via OLLAMA_HOST.
ENV OLLAMA_HOST=http://ollama:11434

EXPOSE 8000
CMD ["uvicorn", "src.api:app", "--host", "0.0.0.0", "--port", "8000"]
