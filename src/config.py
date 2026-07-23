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

# Vision-capable model for the 掃描 (OCR) tab — reads a photographed HA document
# and structures it, in one call. Separate from LLM_MODEL because the chat
# model isn't necessarily multimodal.
OCR_VISION_MODEL = os.getenv("OCR_VISION_MODEL", CONFIG.get("ocr_vision_model", "qwen2.5vl:7b"))

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")

DATA_DIR = PROJECT_ROOT / "data"
CHROMA_DIR = PROJECT_ROOT / "chroma_db"
PROFILE_PATH = PROJECT_ROOT / "user_profile.json"
EVAL_REPORT_PATH = PROJECT_ROOT / "eval" / "results" / "latest.json"
