import json
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = PROJECT_ROOT / "config.json"

with open(CONFIG_PATH, encoding="utf-8") as f:
    CONFIG = json.load(f)

# config.json holds the checked-in defaults; env vars let you override the
# model per environment (dev laptop vs. server) without editing the file.
LLM_MODEL = os.getenv("OLLAMA_MODEL", CONFIG.get("llm_model", "qwen3:32b"))
EMBEDDING_MODEL = os.getenv("OLLAMA_EMBEDDING_MODEL", CONFIG.get("embedding_model", "nomic-embed-text"))
TEMPERATURE = float(os.getenv("OLLAMA_TEMPERATURE", CONFIG.get("temperature", 0.3)))
HK_GUIDELINES = CONFIG.get("hk_guidelines", True)

# Ollama's default context window (2048-4096 depending on model) is too small
# once you add system prompt + profile + RAG context + chat history — and
# "thinking" models (qwen3.x) can silently burn the whole budget on invisible
# <think> reasoning and hit the ceiling before emitting any visible answer
# (done_reason="length", empty content — reproduced and confirmed via a raw
# ChatOllama call while debugging an empty-reply report). 16384 gives
# comfortable headroom; override if you hit it again with a longer chat history.
OLLAMA_NUM_CTX = int(os.getenv("OLLAMA_NUM_CTX", CONFIG.get("ollama_num_ctx", 16384)))

# Vision-capable model for the 掃描 (OCR) tab — reads a photographed HA document
# and structures it, in one call. Separate from LLM_MODEL because the chat
# model isn't necessarily multimodal.
OCR_VISION_MODEL = os.getenv("OCR_VISION_MODEL", CONFIG.get("ocr_vision_model", "qwen2.5vl:7b"))

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")

DATA_DIR = PROJECT_ROOT / "data"
CHROMA_DIR = PROJECT_ROOT / "chroma_db"
PROFILE_PATH = PROJECT_ROOT / "user_profile.json"
EVAL_REPORT_PATH = PROJECT_ROOT / "eval" / "results" / "latest.json"
