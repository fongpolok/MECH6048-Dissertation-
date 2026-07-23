"""OCR, two use cases sharing one local vision model (see src/config.py
OCR_VISION_MODEL):

1. The 掃描 (Scan) tab: reads a photographed Hospital Authority document
   (discharge summary, lab report, prescription, appointment notice) and
   structures it into the shape the frontend's ScanTab renders.
2. The RAG ingestion pipeline (src/text_processor.py): some PDFs dropped into
   data/ are scanned images with no real text layer — PyPDFLoader silently
   extracts nothing from them. transcribe_page() OCRs such a page into plain
   text so it's still searchable, instead of the document silently
   contributing zero chunks.

No cloud OCR service is used in either case — the image never leaves the
machine running Ollama, which matters for medical documents.
"""
from __future__ import annotations

import json

import ollama

from src.config import OCR_VISION_MODEL, OLLAMA_HOST

OCR_PROMPT = """你係一個醫療文件辨識助理，專門處理香港醫院管理局（Hospital Authority）嘅文件，
例如出院摘要、化驗報告、藥物處方、覆診通知等。

請仔細閱讀呢張相入面嘅文件，然後將內容整理成以下嘅 JSON 格式，用繁體中文：

{
  "title": "文件類型，例如 出院摘要 / 化驗報告 / 藥物處方 / 覆診通知",
  "patient": "病人姓名（如果睇唔到就填 未能識別）",
  "pid": "病人編號或文件編號（如果睇唔到就填 未能識別）",
  "issued": "文件發出日期（如果睇唔到就填 未能識別）",
  "sections": [
    {"label": "分類名稱，例如 診斷 / 藥物 / 化驗結果 / 覆診安排", "items": ["逐項列出內容，每項一句"]}
  ]
}

規則：
- 只可以填寫相片入面實際睇到嘅資料，唔可以自己up或者估計數值。
- 如果某部分睇唔清楚或者冇資料，就喺 items 入面寫「文件中未能清晰辨識」，唔好留空或者亂up。
- 只回覆 JSON，唔好加任何其他文字或者解釋。
"""


class OCRError(Exception):
    """Raised when the vision model call fails or doesn't return usable JSON."""


def extract_ha_document(image_bytes: bytes) -> dict:
    client = ollama.Client(host=OLLAMA_HOST)
    try:
        response = client.chat(
            model=OCR_VISION_MODEL,
            messages=[{"role": "user", "content": OCR_PROMPT, "images": [image_bytes]}],
            format="json",
            options={"temperature": 0.1},
        )
    except Exception as exc:  # model not pulled, Ollama down, etc.
        raise OCRError(str(exc)) from exc

    content = response["message"]["content"]
    try:
        data = json.loads(content)
    except json.JSONDecodeError as exc:
        raise OCRError(f"model did not return valid JSON: {exc}") from exc

    # Defensive defaults so a slightly-off model response doesn't 500 the request.
    data.setdefault("title", "醫院文件")
    data.setdefault("patient", "未能識別")
    data.setdefault("pid", "未能識別")
    data.setdefault("issued", "未能識別")
    data.setdefault("sections", [])
    return data


TRANSCRIBE_PROMPT = """請將呢張相入面嘅所有文字，準確咁逐字轉錄成文字，用繁體中文，
盡量保留原本嘅段落、標題同列表結構。如果有表格，用清晰嘅文字方式表達返啲數據，
例如「欄位：數值」咁樣逐項列出。唔好摘要、唔好加意見或者評論，只需要如實轉錄
睇到嘅文字內容。如果張相入面完全冇文字，就只回覆「（無文字內容）」。"""


def transcribe_page(image_bytes: bytes) -> str:
    """Plain OCR transcription of one page image — no structuring, just text.
    Used by the ingestion fallback for scanned PDFs with no text layer."""
    client = ollama.Client(host=OLLAMA_HOST)
    try:
        response = client.chat(
            model=OCR_VISION_MODEL,
            messages=[{"role": "user", "content": TRANSCRIBE_PROMPT, "images": [image_bytes]}],
            options={"temperature": 0.1},
        )
    except Exception as exc:
        raise OCRError(str(exc)) from exc
    return response["message"]["content"].strip()
