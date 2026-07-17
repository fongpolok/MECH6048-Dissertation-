from datetime import date as date_cls

from langchain.tools import tool

from src.utils import load_profile, save_event_log


def _today() -> str:
    return date_cls.today().isoformat()


@tool
def log_blood_pressure(systolic: float, diastolic: float) -> str:
    """Log the user's blood pressure reading (systolic/diastolic, mmHg) for today.
    Appears immediately in their 紀錄 (Records) tab BP trend chart."""
    save_event_log("bp_reading", {"date": _today(), "sys": systolic, "dia": diastolic})
    return f"已經幫你記錄咗今日血壓 {systolic}/{diastolic} mmHg，會顯示喺「紀錄」入面。"


@tool
def log_glucose(value: float) -> str:
    """Log the user's blood glucose reading (mmol/L) for today.
    Appears immediately in their 紀錄 (Records) tab."""
    save_event_log("glucose_reading", {"date": _today(), "value": value})
    return f"已經幫你記錄咗今日血糖 {value} mmol/L，會顯示喺「紀錄」入面。"


@tool
def log_hba1c(value: float) -> str:
    """Log the user's HbA1c (糖化血紅蛋白) reading as a percentage for today.
    Appears immediately in their 紀錄 (Records) tab HbA1c trend chart."""
    save_event_log("hba1c_reading", {"date": _today(), "value": value})
    return f"已經幫你記錄咗今日HbA1c {value}%，會顯示喺「紀錄」入面。"


@tool
def alert_caregiver(message: str) -> str:
    """Alert the user's registered caregiver/emergency contact. Use this for urgent symptoms
    (e.g. chest pain, severe dizziness, suspected stroke) in addition to telling the user to call 999."""
    try:
        phone = load_profile().get("caregiver_phone", "未設定")
    except FileNotFoundError:
        phone = "未設定"
    # Stub: no SMS/telephony provider is wired up yet. Logging here is the extension
    # point for a real notification integration (Twilio, push notification, etc.).
    print(f"[ALERT] to caregiver ({phone}): {message}")
    return f"已通知照顧者（電話：{phone}）：{message}"
