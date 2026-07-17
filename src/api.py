import json
import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from langchain_core.messages import AIMessage, HumanMessage
from pydantic import BaseModel

from src.agent import get_medical_agent
from src.config import EVAL_REPORT_PATH
from src.tools import alert_caregiver
from src.utils import load_event_logs, load_health_logs, load_profile, save_event_log, save_health_log

app = FastAPI(title="HK ElderGuard AI API")

_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _origins if o.strip()],
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


class LogRequest(BaseModel):
    bp: float = 0
    glucose: float = 0


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


class HbA1cRecord(BaseModel):
    date: str
    value: float


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
    return ChatResponse(reply=result["answer"], sources=result["sources"])


@app.post("/api/log")
def log_reading(req: LogRequest):
    return save_health_log(bp=req.bp, glucose=req.glucose)


@app.get("/api/log")
def get_logs(limit: int = 50):
    return load_health_logs(limit=limit)


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
def get_bp_records(limit: int = 50):
    events = load_event_logs(limit=1000)
    return [e for e in events if e.get("type") == "bp_reading"][-limit:]


@app.post("/api/records/hba1c")
def log_hba1c_record(req: HbA1cRecord):
    return save_event_log("hba1c_reading", req.model_dump())


@app.get("/api/records/hba1c")
def get_hba1c_records(limit: int = 50):
    events = load_event_logs(limit=1000)
    return [e for e in events if e.get("type") == "hba1c_reading"][-limit:]


@app.get("/api/events")
def get_events(limit: int = 50):
    return load_event_logs(limit=limit)


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
