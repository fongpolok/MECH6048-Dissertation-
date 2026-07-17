from src.vector_store import get_vector_store

# k=4 measurably under-retrieved specific numeric thresholds (e.g. the 130/80
# vs 140/90 mmHg targets) in eval/qa_testset.jsonl's grounded_fact cases.
# Bumping to k=8 was tried and re-measured (see README "Testing LLM/app
# accuracy" section) — it did NOT fix the recall problem by itself; the
# thresholds live in table-formatted PDF chunks that apparently don't embed
# well semantically against conversational Cantonese questions with
# nomic-embed-text. Left at 8 since it's not worse and is a step toward a
# real fix (better table-aware chunking, query rewriting, or reranking —
# see README limitations).
def get_retriever(k=8):
    vector_store = get_vector_store()
    return vector_store.as_retriever(search_kwargs={"k": k})