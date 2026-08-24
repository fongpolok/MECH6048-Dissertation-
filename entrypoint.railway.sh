#!/bin/bash
set -e

# Ollama runs in-container purely as an embedding server (nomic-embed-text —
# small, CPU-friendly) so RAG retrieval stays in the same vector space as the
# pre-built chroma_db/ this image ships. Chat itself goes to DeepSeek's API
# (see src/providers.py / model_settings.json) — no chat LLM is pulled here,
# that's what would actually need a GPU.
ollama serve &
OLLAMA_PID=$!

echo "Waiting for Ollama to be ready..."
until curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; do
  sleep 1
done

echo "Pulling embedding model (nomic-embed-text)..."
ollama pull nomic-embed-text

echo "Starting API on port ${PORT:-8000}..."
exec uvicorn src.api:app --host 0.0.0.0 --port "${PORT:-8000}"
