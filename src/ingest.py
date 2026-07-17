from src.config import DATA_DIR
from src.text_processor import process_documents
from src.vector_store import create_vector_store


def ingest_documents():
    print(f"Starting document ingestion for HK health guidelines from {DATA_DIR}...")
    documents = process_documents(str(DATA_DIR))
    vector_store = create_vector_store(documents)
    print(f"Ingested {len(documents)} chunks into Chroma DB")
    return vector_store


if __name__ == "__main__":
    ingest_documents()
