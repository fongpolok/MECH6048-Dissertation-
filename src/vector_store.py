from langchain_chroma import Chroma
from langchain_ollama import OllamaEmbeddings

from src.config import CHROMA_DIR, EMBEDDING_MODEL, OLLAMA_HOST

# Some Ollama builds crash the model runner ("EOF"/connection reset) when a
# single /api/embed call carries a few hundred+ inputs (observed with ~1000
# chunks from the HK guideline PDFs). Batching sidesteps that instability and
# also gives visible ingestion progress for large document sets.
EMBED_BATCH_SIZE = 32


def _embeddings():
    return OllamaEmbeddings(model=EMBEDDING_MODEL, base_url=OLLAMA_HOST)


def create_vector_store(documents):
    embeddings = _embeddings()
    vector_store = Chroma(persist_directory=str(CHROMA_DIR), embedding_function=embeddings)

    for i in range(0, len(documents), EMBED_BATCH_SIZE):
        batch = documents[i : i + EMBED_BATCH_SIZE]
        vector_store.add_documents(batch)
        print(f"  embedded {min(i + EMBED_BATCH_SIZE, len(documents))}/{len(documents)} chunks")

    return vector_store


def get_vector_store():
    return Chroma(persist_directory=str(CHROMA_DIR), embedding_function=_embeddings())
