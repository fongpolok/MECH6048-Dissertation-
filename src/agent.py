from __future__ import annotations

import os

from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain.tools import tool
from langchain_core.prompts import ChatPromptTemplate

from src.config import TEMPERATURE
from src.providers import build_chat_model
from src.retriever import get_retriever
from src.tools import alert_caregiver, log_blood_pressure, log_glucose, log_hba1c

SYSTEM_PROMPT = """你係「HK ElderGuard AI」，一位專門幫助香港長者管理高血壓同糖尿病嘅健康助理。

回答規則：
1. 一律用廣東話口語回答，句子要短、用詞要淺白，避免醫學術語，唔好用英文專業詞彙。
2. 你嘅建議必須根據下面「政府/醫管局指引資料」嘅內容。如果資料入面搵唔到答案，要老實講「呢個問題我暫時未有官方指引資料，建議你直接問醫生或護士」，唔可以憑空up資料、藥物名或劑量。
3. 如果使用者提到胸口痛、嚴重氣促、單側手腳無力、說話含糊、突然劇烈頭痛等中風/心臟病徵狀，你必須第一時間叫佢即刻打999或用「緊急求助」按鈕，唔好先討論其他嘢。
4. 如果使用者喺傾偈入面講咗具體嘅血壓（例如「130/80」）、血糖（mmol/L）或者HbA1c（%）數值，你應該主動用相應工具幫佢記錄低，之後會自動顯示喺「紀錄」頁面，唔使使用者自己入。你只可以喺真正調用咗個工具之後，先可以講「已經幫你記錄咗/通知咗」；如果你冇調用工具，就千祈唔好聲稱你做咗呢個動作。
5. 已知使用者資料：{profile_summary}

政府/醫管局指引資料（回答要以呢啲資料為準，唔好引用資料以外嘅內容）：
{context}
"""


def _format_profile(profile: dict) -> str:
    meds = "、".join(f"{m['name']}({m.get('dose', '')})" for m in profile.get("medications", []))
    conditions = "、".join(profile.get("conditions", []))
    return f"{profile.get('name', '未知')}，{profile.get('age', '?')}歲，患有：{conditions or '無記錄'}；正在服用：{meds or '無記錄'}"


def _format_context(docs) -> str:
    if not docs:
        return "（無相關資料）"
    return "\n\n".join(f"[來源: {os.path.basename(d.metadata.get('source', '?'))}] {d.page_content}" for d in docs)


class MedicalAgent:
    """Wraps the Ollama LLM + HK guideline retriever + tools into a single ask() call.

    Retrieval always runs for grounding (elderly-safety: never rely on the model
    choosing to look things up), while a search tool is also exposed so the agent
    can issue a follow-up, more targeted query mid-reasoning if it needs to.
    """

    def __init__(self, provider: str, model: str):
        self.provider = provider
        self.model = model
        self.llm = build_chat_model(provider, model, TEMPERATURE)
        self.retriever = get_retriever()

        @tool
        def search_hk_guidelines(query: str) -> str:
            """Search official HK health guideline documents (hypertension, diabetes, CDCC)
            for a specific follow-up question. Returns the most relevant excerpts."""
            return _format_context(self.retriever.invoke(query))

        self.tools = [log_blood_pressure, log_glucose, log_hba1c, alert_caregiver, search_hk_guidelines]

        prompt = ChatPromptTemplate.from_messages(
            [
                ("system", SYSTEM_PROMPT),
                ("placeholder", "{chat_history}"),
                ("human", "{input}"),
                ("placeholder", "{agent_scratchpad}"),
            ]
        )
        agent = create_tool_calling_agent(self.llm, self.tools, prompt)
        self.executor = AgentExecutor(
            agent=agent,
            tools=self.tools,
            verbose=True,
            handle_parsing_errors=True,
            return_intermediate_steps=True,
        )

    def ask(self, message: str, profile: dict, chat_history: list | None = None) -> dict:
        docs = self.retriever.invoke(message)
        context = _format_context(docs)
        result = self.executor.invoke(
            {
                "input": message,
                "profile_summary": _format_profile(profile),
                "context": context,
                "chat_history": chat_history or [],
            }
        )
        sources = sorted({os.path.basename(d.metadata.get("source", "?")) for d in docs})
        steps = result.get("intermediate_steps", [])
        tool_calls = [step[0].tool for step in steps]

        answer = (result["output"] or "").strip()
        if not answer and steps:
            # After a tool call, the model occasionally emits no closing text
            # at all (empty final message) — the user would see a blank reply
            # right after asking to log something. The tool's own return
            # value is already a friendly Cantonese confirmation (see
            # src/tools.py), so fall back to that instead of showing nothing.
            answer = "\n".join(step[1] for step in steps if isinstance(step[1], str)) or answer

        # Safety-critical guardrail, not just a style fallback: alert_caregiver
        # exists for urgent symptoms *in addition to* telling the user to call
        # 999 (system prompt rule 3) — a caregiver notification is never a
        # substitute for that, since the caregiver may not see it in time.
        # Confirmed via eval regression (severe_breathlessness case): the model
        # called alert_caregiver, emitted no closing text, and the fallback
        # above then surfaced only the tool's own confirmation string — which
        # never mentions 999 — as the entire reply. Enforced deterministically
        # here rather than trusting the model to remember it every time.
        if "alert_caregiver" in tool_calls and "999" not in answer:
            answer = "請即刻打999或者用APP入面嘅「緊急求助」按鈕求助！\n\n" + answer

        return {
            "answer": answer,
            "sources": sources,
            "tool_calls": tool_calls,
            "context": context,
        }


_agents: dict[tuple[str, str], MedicalAgent] = {}


def get_medical_agent(provider: str | None = None, model: str | None = None) -> MedicalAgent:
    """Build an agent once per (provider, model) and reuse it — constructing a
    chat client/the retriever per request would reconnect on every chat message.

    Cached per-pair rather than as a single singleton because the Settings tab
    lets the user switch models at runtime, and the eval harnesses compare
    several providers in one process — both need more than one live agent.
    """
    from src.utils import load_model_selection  # local import: avoids a cycle at module load time

    if provider is None or model is None:
        selection = load_model_selection()
        provider = provider or selection["provider"]
        model = model or selection["model"]

    key = (provider, model)
    if key not in _agents:
        _agents[key] = MedicalAgent(provider, model)
    return _agents[key]


def create_medical_agent() -> MedicalAgent:
    """Kept for backwards compatibility with the original API shape."""
    return get_medical_agent()
