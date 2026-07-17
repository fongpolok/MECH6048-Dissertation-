from langchain.tools import tool

from src.utils import load_profile, save_health_log


@tool
def log_blood_pressure(bp_value: float) -> str:
    """Log the user's blood pressure reading (mmHg, e.g. the systolic number)."""
    save_health_log(bp=bp_value)
    return f"已記錄血壓 {bp_value} mmHg。"


@tool
def log_glucose(glucose_value: float) -> str:
    """Log the user's blood glucose reading (mmol/L)."""
    save_health_log(glucose=glucose_value)
    return f"已記錄血糖 {glucose_value} mmol/L。"


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
