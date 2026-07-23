"""Exercises the real PDF ingestion pipeline against data/*.pdf. No network or
Ollama server required: any scanned PDF with no text layer has its OCR result
cached in a committed <file>.pdf.ocr.txt sidecar (see src/text_processor.py)."""
from langchain_core.documents import Document

import src.text_processor as text_processor
from src.config import DATA_DIR
from src.text_processor import _needs_ocr_fallback, process_documents


def test_process_documents_chunks_real_pdfs():
    docs = process_documents(str(DATA_DIR))
    assert len(docs) > 0
    for doc in docs[:5]:
        assert doc.page_content.strip() != ""
        assert "source" in doc.metadata


def test_needs_ocr_fallback_true_for_empty_text():
    docs = [Document(page_content="   ", metadata={}), Document(page_content="", metadata={})]
    assert _needs_ocr_fallback(docs) is True


def test_needs_ocr_fallback_false_for_real_text():
    docs = [Document(page_content="a" * 200, metadata={})]
    assert _needs_ocr_fallback(docs) is False


def test_ocr_pdf_uses_cache_without_calling_vision_model(tmp_path, monkeypatch):
    pdf_path = tmp_path / "scanned.pdf"
    pdf_path.write_bytes(b"fake-pdf-bytes")
    cache_path = tmp_path / "scanned.pdf.ocr.txt"
    cache_path.write_text("第一頁內容\f第二頁內容", encoding="utf-8")

    def boom(image_bytes):
        raise AssertionError("should not call the vision model when a fresh cache exists")

    monkeypatch.setattr(text_processor, "transcribe_page", boom)

    docs = text_processor._ocr_pdf(str(pdf_path), "scanned.pdf")
    assert [d.page_content for d in docs] == ["第一頁內容", "第二頁內容"]
