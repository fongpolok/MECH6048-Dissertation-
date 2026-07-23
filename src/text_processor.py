import io
import os

from langchain_community.document_loaders import PyPDFLoader
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

from src.ocr import OCRError, transcribe_page

# Below this many characters across a whole PDF, treat it as having no real
# text layer (a scan/photo saved as PDF) rather than just a short document.
MIN_EXTRACTED_CHARS = 40

# Page-feed separator between cached OCR'd pages in the .ocr.txt sidecar file.
PAGE_SEPARATOR = "\f"


def _needs_ocr_fallback(docs: list[Document]) -> bool:
    return sum(len(d.page_content.strip()) for d in docs) < MIN_EXTRACTED_CHARS


def _ocr_pdf(path: str, filename: str) -> list[Document]:
    """OCRs a scanned PDF with the local vision model and caches the result in a
    `<file>.pdf.ocr.txt` sidecar next to it — committed to git so re-running
    ingestion (or the test suite) never needs Ollama/network after the first
    time. Delete the sidecar to force a re-OCR (e.g. after swapping OCR_VISION_MODEL)."""
    cache_path = path + ".ocr.txt"
    if os.path.exists(cache_path) and os.path.getmtime(cache_path) >= os.path.getmtime(path):
        with open(cache_path, encoding="utf-8") as f:
            pages = f.read().split(PAGE_SEPARATOR)
        return [
            Document(page_content=text, metadata={"source": path, "page": i})
            for i, text in enumerate(pages)
            if text.strip()
        ]

    from pdf2image import convert_from_path  # imported lazily: needs poppler installed

    print(f"  {filename}: no text layer found, OCR'ing with the local vision model (cached afterwards)...")
    page_images = convert_from_path(path, dpi=200)
    texts: list[str] = []
    for i, page_image in enumerate(page_images):
        buf = io.BytesIO()
        page_image.save(buf, format="PNG")
        try:
            texts.append(transcribe_page(buf.getvalue()))
        except OCRError as exc:
            print(f"    page {i + 1}: OCR failed ({exc}), skipping this page")
            texts.append("")

    with open(cache_path, "w", encoding="utf-8") as f:
        f.write(PAGE_SEPARATOR.join(texts))

    return [
        Document(page_content=text, metadata={"source": filename, "page": i})
        for i, text in enumerate(texts)
        if text.strip()
    ]


def process_documents(directory: str):
    documents = []
    splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=150)

    for filename in os.listdir(directory):
        if filename.endswith(".pdf"):
            path = os.path.join(directory, filename)
            docs = PyPDFLoader(path).load()
            if _needs_ocr_fallback(docs):
                docs = _ocr_pdf(path, filename)
            documents.extend(splitter.split_documents(docs))
    return documents
