"""Exercises the real PDF ingestion pipeline against data/*.pdf. Requires the
pypdf/langchain packages but no network or Ollama server."""
from src.config import DATA_DIR
from src.text_processor import process_documents


def test_process_documents_chunks_real_pdfs():
    docs = process_documents(str(DATA_DIR))
    assert len(docs) > 0
    for doc in docs[:5]:
        assert doc.page_content.strip() != ""
        assert "source" in doc.metadata
