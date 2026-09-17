# Hosting & data flow

Short reference for how HK ElderGuard AI is deployed today, what leaves the
machine, and where that sits relative to a Hong Kong–hosted / on-prem
expectation (e.g. stakeholder feedback on health-query privacy).

This is **not** a signed-off architecture decision. It documents the current
code paths so product and engineering can align before changing hosting.

## Two run modes

| Mode | How you start it | Chat LLM | Embeddings / RAG | OCR (掃描) |
|---|---|---|---|---|
| **A. Local / on-prem privacy** | `ollama serve` + `uvicorn` (or `docker compose` with the `ollama` service) | Local Ollama (`provider=ollama`) | Local Ollama embeddings + on-disk `chroma_db/` | Local vision model via Ollama — image stays on the host |
| **B. Hosted demo (Railway)** | `Dockerfile.railway` + `entrypoint.railway.sh` | Cloud chat (default selection in `model_settings.json` is DeepSeek) | In-container Ollama, embeddings only (`nomic-embed-text`) | Same OCR code path, but only if a vision model is available on that host’s Ollama |

Mode A matches the product’s privacy-first label in Settings
（「本機 Ollama（免費・私隱優先）」）. Mode B exists so a public demo can run
without a GPU chat model in the container.

## What leaves the machine

### Mode A — local Ollama chat

- **User chat text / health Q&A:** stays on the host (Ollama).
- **Guideline corpus (`data/*.pdf`) and `chroma_db/`:** local disk.
- **BP / glucose / medication logs:** written by the backend tools to local
  storage on the API host (not a third-party EHR).
- **Scanned HA documents (OCR):** never sent to a cloud OCR API; processed by
  the local vision model (`OCR_VISION_MODEL`, default `qwen2.5vl`).
- **Cloud providers (Anthropic / Google / DeepSeek):** only if someone
  switches provider in Settings **and** the matching API key is configured.
  Then chat prompts go to that provider’s API.

### Mode B — Railway-style hosted demo

- **Chat prompts and model replies:** go to the configured cloud chat
  provider (currently `deepseek` / `deepseek-v4-flash` in `model_settings.json`).
- **Embeddings for RAG:** stay inside the container’s Ollama process.
- **Pre-built `chroma_db/`:** shipped in the image; retrieval vectors are
  computed against that local store.
- **Region:** Railway (and DeepSeek’s API) are **not** documented here as
  Hong Kong–region or on-prem. Treat Mode B as a **demo / evaluation** path,
  not as meeting a “HK-hosted or on-prem for health queries” requirement.

## Network surface

- Backend: FastAPI (`src/api.py`), default port `8000`.
- Frontend (designed UI): Vite React app under
  `Figma/Elderly Health AI Agent/` (dev server pinned to port `5178` in the
  current working tree).
- CORS: `CORS_ORIGINS` (see `.env.example`).
- Compose frontend build arg `VITE_API_URL` must point at the reachable API.

## Gap vs “HK-hosted / on-prem for health queries”

| Expectation (stakeholder soft constraint) | Current status |
|---|---|
| Health queries processed in HK or on-prem | **Mode A** can be on-prem / air-gapped if Ollama + API stay on that host. **Mode B** sends chat to a non-HK cloud provider by default. |
| Clear privacy architecture | Documented above; Settings can still switch to cloud LLMs when keys exist. |
| Product boundary | Safety / refusal behaviour is enforced in the agent prompt and (locally, uncommitted) surfaced in UI as a safety-refusal matrix — separate from hosting. |
| Cost / compute model | Not costed here. Mode A needs local GPU/unified memory for useful chat models; Mode B trades that for cloud API spend. |
| Clinician pathway | Escalation / referral policy is product behaviour, not a hosting concern. |

## Recommended default for demos that must honour privacy feedback

1. Run **Mode A** (local or private docker-compose) with `provider=ollama`.
2. Do **not** configure cloud API keys on that host unless a named exception
   is approved.
3. Keep Mode B for non-PHI demos and engineering smoke tests only, until a
   HK-region or on-prem hosted path is chosen.

## Open decisions (need Edward / client)

1. Is production target **on-prem appliance**, **HK cloud region**, or
   **hybrid** (local chat, remote static assets only)?
2. Should Settings hide / disable cloud providers in builds meant for
   clinical or elderly pilots?
3. Should Railway demo stay DeepSeek-backed, or be retired once a HK/on-prem
   staging environment exists?

---

*Drafted for alignment; not committed as a product commitment until reviewed.*
