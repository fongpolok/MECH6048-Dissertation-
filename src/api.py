import json
import os
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from langchain_core.messages import AIMessage, HumanMessage
from pydantic import BaseModel

from src.agent import get_medical_agent
from src.config import EVAL_REPORT_PATH
from src.ocr import OCRError, extract_ha_document
from src.tools import alert_caregiver
from src.utils import load_event_logs, load_profile, save_event_log, update_event_log

# The system prompt (rule #3) requires the agent to lead with "call 999" for
# red-flag symptoms — "first thing, before discussing anything else". So a
# genuine emergency reply has "999" right at the start; a merely cautious
# closing reminder ("if anything feels wrong, call 999") on an otherwise
# routine answer does not, and shouldn't trigger the emergency UI. A bare
# substring check false-positives on exactly that closing-reminder case.
EMERGENCY_MARKER = "999"
EMERGENCY_MARKER_MAX_POSITION = 80


def _is_emergency_reply(answer: str) -> bool:
    idx = answer.find(EMERGENCY_MARKER)
    return 0 <= idx <= EMERGENCY_MARKER_MAX_POSITION

app = FastAPI(title="HK ElderGuard AI API")

_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
# Also allow any private-LAN IP on the Vite dev port, so an iPhone on the same
# Wi-Fi (e.g. http://192.168.x.x:5173) works without editing CORS_ORIGINS every
# time DHCP hands out a different address. Restricted to RFC1918 ranges only.
_lan_origin_regex = r"^http://(192\.168|10\.\d{1,3}|172\.(1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}:5173$"
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _origins if o.strip()],
    allow_origin_regex=_lan_origin_regex,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatTurn(BaseModel):
    role: str  # "user" | "agent"
    text: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatTurn] = []


class ChatResponse(BaseModel):
    reply: str
    sources: list[str] = []
    is_emergency: bool = False


class AlertRequest(BaseModel):
    message: str


class MedicationEvent(BaseModel):
    name: str
    taken: bool


class WellnessSubmission(BaseModel):
    answers: dict[str, str]


class BPRecord(BaseModel):
    date: str
    sys: float
    dia: float


class BPRecordPatch(BaseModel):
    date: Optional[str] = None
    sys: Optional[float] = None
    dia: Optional[float] = None


class GlucoseRecord(BaseModel):
    date: str
    value: float


class GlucoseRecordPatch(BaseModel):
    date: Optional[str] = None
    value: Optional[float] = None


class HbA1cRecord(BaseModel):
    date: str
    value: float


class HbA1cRecordPatch(BaseModel):
    date: Optional[str] = None
    value: Optional[float] = None


def _apply_patch(entry_id: str, patch_model: BaseModel) -> dict:
    patch = {k: v for k, v in patch_model.model_dump().items() if v is not None}
    updated = update_event_log(entry_id, patch)
    if updated is None:
        raise HTTPException(status_code=404, detail="record not found")
    return updated


def _records_of_type(event_type: str, limit: int) -> list[dict]:
    events = load_event_logs(limit=2000)
    return [e for e in events if e.get("type") == event_type][-limit:]


def _to_langchain_history(history: list[ChatTurn]):
    converted = []
    for turn in history:
        if turn.role == "user":
            converted.append(HumanMessage(content=turn.text))
        else:
            converted.append(AIMessage(content=turn.text))
    return converted


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/profile")
def get_profile():
    try:
        return load_profile()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="user_profile.json not found")


@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="message must not be empty")
    profile = load_profile()
    agent = get_medical_agent()
    try:
        result = agent.ask(req.message, profile, chat_history=_to_langchain_history(req.history))
    except Exception as exc:  # Ollama down, model missing, etc.
        raise HTTPException(status_code=502, detail=f"LLM backend error: {exc}") from exc
    return ChatResponse(reply=result["answer"], sources=result["sources"], is_emergency=_is_emergency_reply(result["answer"]))


@app.post("/api/alert")
def alert(req: AlertRequest):
    return {"result": alert_caregiver.invoke({"message": req.message})}


@app.post("/api/medications/log")
def log_medication(req: MedicationEvent):
    return save_event_log("medication", req.model_dump())


@app.post("/api/wellness")
def submit_wellness(req: WellnessSubmission):
    return save_event_log("wellness", req.model_dump())


@app.post("/api/records/bp")
def log_bp_record(req: BPRecord):
    return save_event_log("bp_reading", req.model_dump())


@app.get("/api/records/bp")
def get_bp_records(limit: int = 100):
    return _records_of_type("bp_reading", limit)


@app.patch("/api/records/bp/{record_id}")
def amend_bp_record(record_id: str, req: BPRecordPatch):
    return _apply_patch(record_id, req)


@app.post("/api/records/glucose")
def log_glucose_record(req: GlucoseRecord):
    return save_event_log("glucose_reading", req.model_dump())


@app.get("/api/records/glucose")
def get_glucose_records(limit: int = 100):
    return _records_of_type("glucose_reading", limit)


@app.patch("/api/records/glucose/{record_id}")
def amend_glucose_record(record_id: str, req: GlucoseRecordPatch):
    return _apply_patch(record_id, req)


@app.post("/api/records/hba1c")
def log_hba1c_record(req: HbA1cRecord):
    return save_event_log("hba1c_reading", req.model_dump())


@app.get("/api/records/hba1c")
def get_hba1c_records(limit: int = 100):
    return _records_of_type("hba1c_reading", limit)


@app.patch("/api/records/hba1c/{record_id}")
def amend_hba1c_record(record_id: str, req: HbA1cRecordPatch):
    return _apply_patch(record_id, req)


@app.get("/api/events")
def get_events(limit: int = 50):
    return load_event_logs(limit=limit)


MAX_SCAN_UPLOAD_BYTES = 15 * 1024 * 1024  # 15MB — a phone camera photo comfortably fits


@app.post("/api/ocr/scan")
async def ocr_scan(file: UploadFile = File(...)):
    """Reads a photographed Hospital Authority document (discharge summary, lab
    report, prescription, appointment notice) with a local vision model and
    returns it structured. The image itself is not persisted — only the
    extracted text — since these are medical documents (see src/ocr.py)."""
    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="empty file")
    if len(image_bytes) > MAX_SCAN_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="image too large (max 15MB)")
    try:
        doc = extract_ha_document(image_bytes)
    except OCRError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"OCR failed — is the vision model pulled (`ollama pull qwen2.5vl:7b`) and Ollama running? {exc}",
        ) from exc
    return save_event_log("scan_result", doc)


@app.get("/api/scans")
def get_scans(limit: int = 50):
    return _records_of_type("scan_result", limit)


@app.get("/api/eval/latest")
def get_eval_report():
    """Serves the last `python -m eval.evaluate` run (accuracy / hallucination /
    safety-critical pass rates) for the app's Testing tab. Static file, not a
    live re-run — a full pass takes minutes against a real Ollama model."""
    if not EVAL_REPORT_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail="No evaluation report yet. Run `python -m eval.evaluate` on the backend host first.",
        )
    with open(EVAL_REPORT_PATH, encoding="utf-8") as f:
        return json.load(f)
