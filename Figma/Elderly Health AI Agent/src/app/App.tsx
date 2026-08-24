import { useState, useRef, useEffect } from "react";
import {
  MessageCircle, Pill, Heart, Activity, Phone,
  Send, Check, Bell, User, Home,
  Mic, MicOff, Video, Clock, Star, Stethoscope,
  ChevronRight, Wifi, Battery, Signal, Plus, X,
  TrendingUp, BarChart2, Settings, ChevronLeft,
  ShieldCheck, RefreshCw, CheckCircle2, XCircle, AlertTriangle,
  Camera, FileText, Loader, Scan, AlarmClock, ChevronDown, ScanText, Cpu,
  KeyRound, Eye, EyeOff,
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Legend,
} from "recharts";
import {
  sendChatMessage, logMedication, alertCaregiver,
  logBPRecord, getBPRecords, amendBPRecord,
  logGlucoseRecord, getGlucoseRecords, amendGlucoseRecord,
  logHbA1cRecord, getHbA1cRecords, amendHbA1cRecord,
  scanDocument, getScans,
  getEvalReport, getOcrEvalReport, getHallucinationReport,
  getModels, selectModel, setProviderApiKey,
  type ChatTurn, type EvalReport, type OcrEvalReport, type HallucinationReport,
  type ModelsResponse,
} from "./lib/api";

type Mode = "carer" | "user";
// 醫療 (consult) and 測試 (eval) stay reachable — via Settings, not the bottom
// tab bar — rather than dropping the features the same "Testing" and
// "video consult" requirements from earlier asked for. See TabBar/SettingsTab.
type CarerTab = "home" | "chat" | "medications" | "records" | "scan" | "consult" | "settings" | "eval";
type UserTab = "home" | "chat";
type Tab = CarerTab | UserTab;
type Message = { id: string; role: "user" | "agent"; text: string; time: string; isEmergency?: boolean };
type Profile = { name: string; age: string; gender: "男" | "女" | "" };
type BPEntry = { id?: string; date: string; sys: number; dia: number };
type GlucoseEntry = { id?: string; date: string; value: number };
type HbA1cEntry = { id?: string; date: string; value: number };
type ScannedDoc = { id: string; title: string; patient: string; pid: string; issued: string; sections: { label: string; items: string[] }[] };

// Same heuristic the backend uses (src/api.py _is_emergency_reply) — kept in
// sync so the offline/demo fallback path (no backend reachable) still
// surfaces the same inline emergency action button. Checks position, not
// just presence: the system prompt requires leading with "call 999" for
// red-flag symptoms, so a genuine emergency reply has it near the very
// start — a routine answer that merely closes with "if anything feels wrong,
// call 999" as a general safety reminder should NOT trigger the button.
function isEmergencyReply(text: string): boolean {
  const idx = text.indexOf("999");
  return idx >= 0 && idx <= 80;
}

// On a real phone (opened from an iPhone over LAN, or added to the Home
// Screen), the decorative "iPhone mockup" frame + fake status bar/dynamic
// island would double up with the device's own chrome. Only show the mockup
// frame on a desktop-sized viewport, where it's the intended preview effect.
function useIsRealMobileDevice(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 430px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isMobile;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const evalCategoryLabels: Record<string, string> = {
  grounded_fact: "資料準確度 (Grounded Facts)",
  safety_critical: "緊急安全觸發 (Safety-Critical)",
  hallucination_trap: "防止亂up資料 (Hallucination Trap)",
  tool_claim_consistency: "工具動作一致性 (Tool-Claim)",
};

// Chinese labels for dm_ht_hk_elderly_questions.csv's 10 categories.
const hallucinationCategoryLabels: Record<string, string> = {
  "Medication Dosage": "藥物劑量",
  "Drug Interactions": "藥物相互作用",
  "Diet": "飲食",
  "Symptom Triage": "徵狀分流",
  "Monitoring": "監測",
  "Complications & Aftercare": "併發症與善後護理",
  "Emergency": "緊急情況",
  "Policy/Scheme": "政策／計劃",
  "Statistics": "統計數字",
  "Myths & Beliefs": "迷思與謬誤",
};

function rateColor(rate: number): string {
  if (rate >= 0.9) return "#34C759";
  if (rate >= 0.5) return "#FF9500";
  return "#FF3B30";
}

// Hallucination RATE coloring is inverted from pass-RATE coloring (rateColor
// above): for a pass rate, higher is better and green; for a hallucination
// rate, LOWER is better and green — reusing rateColor on a hallucination rate
// would paint a dangerous 90% hallucination rate green.
function hallucinationRateColor(rate: number): string {
  if (rate <= 0.05) return "#34C759";
  if (rate <= 0.2) return "#FF9500";
  return "#FF3B30";
}

// ── AI responses ──────────────────────────────────────────────────────────────
const agentResponses: Record<string, string> = {
  default: "我明白您的情況。可以詳細描述一下您現在的感覺嗎？例如是否有頭暈、胸悶或其他不適？",
  bloodPressure: "高血壓需要特別注意。如果血壓超過140/90mmHg，請立即聯絡醫生。記得按時服用血壓藥，唔好自行停藥。",
  bloodSugar: "血糖管理對糖尿病患者非常重要。正常空腹血糖應在4.0至7.0 mmol/L之間。如血糖異常，請即時告知家人或聯絡醫生。",
  headache: "頭痛有時可能係血壓偏高的徵兆。建議您立即量血壓。如頭痛持續或劇烈，請盡快睇醫生。",
  dizzy: "頭暈可能係血壓波動或血糖偏低引起。請先坐低休息，測一下血糖和血壓。血糖低於4.0請立即飲一杯橙汁。",
  chest: "胸口不適係嚴重警號！請立即按緊急按鈕或致電999。唔好自己開車去醫院，要等救護車。",
  medication: "按時服藥對控制高血壓和糖尿病非常重要。如果您忘記服藥，切記唔好一次過服兩次劑量。",
  tired: "疲倦感有時與血糖波動有關。請先測一下血糖，記住每日要有充足睡眠，避免過度勞累。",
  foot: "糖尿病患者要特別注意腳部護理。請每日檢查雙腳有冇傷口、紅腫或麻痺感。如發現任何傷口，即使小傷口都要盡快睇醫生。",
  diet: "飲食控制對高血壓和糖尿病都非常重要。建議少食多餐，避免高糖、高鹽、高脂食物。",
  hello: "您好！我係您的健康助理，專門協助管理高血壓同糖尿病。今日感覺點呀？",
};
function getAgentResponse(msg: string): string {
  const t = msg.toLowerCase();
  if (t.includes("血壓") || t.includes("高血壓")) return agentResponses.bloodPressure;
  if (t.includes("血糖") || t.includes("糖尿") || t.includes("hba1c") || t.includes("糖化")) return agentResponses.bloodSugar;
  if (t.includes("頭痛")) return agentResponses.headache;
  if (t.includes("頭暈") || t.includes("暈")) return agentResponses.dizzy;
  if (t.includes("胸") || t.includes("心口")) return agentResponses.chest;
  if (t.includes("藥")) return agentResponses.medication;
  if (t.includes("攰") || t.includes("疲")) return agentResponses.tired;
  if (t.includes("腳")) return agentResponses.foot;
  if (t.includes("食") || t.includes("飲食")) return agentResponses.diet;
  if (t.includes("你好") || t.includes("早")) return agentResponses.hello;
  return agentResponses.default;
}

// ── Static data ───────────────────────────────────────────────────────────────
// time24 (HH:MM, 24h) drives the medication alarm — time is just the display string.
const medications = [
  { name: "氨氯地平", english: "Amlodipine 5mg", time: "早上 8:00", time24: "08:00", note: "血壓藥", color: "#007AFF", initially: true },
  { name: "二甲雙胍", english: "Metformin 500mg", time: "早上 8:00", time24: "08:00", note: "糖尿藥", color: "#34C759", initially: true },
  { name: "格列齊特", english: "Gliclazide 30mg", time: "下午 1:00", time24: "13:00", note: "糖尿藥", color: "#34C759", initially: false },
  { name: "依那普利", english: "Enalapril 10mg", time: "晚上 8:00", time24: "20:00", note: "血壓藥", color: "#007AFF", initially: false },
];

// Daily granularity now — 記錄 tracks day-by-day, not month-by-month. These
// bundled series are only the first-run placeholder; getBPRecords()/
// getGlucoseRecords()/getHbA1cRecords() replace them with real history once
// the backend has any (see the hydration effect below).
const defaultBP: BPEntry[] = [
  { date: daysAgoISO(6), sys: 138, dia: 88 },
  { date: daysAgoISO(5), sys: 135, dia: 86 },
  { date: daysAgoISO(4), sys: 133, dia: 85 },
  { date: daysAgoISO(3), sys: 129, dia: 82 },
  { date: daysAgoISO(2), sys: 131, dia: 83 },
  { date: daysAgoISO(1), sys: 127, dia: 80 },
  { date: todayISO(), sys: 130, dia: 81 },
];

const defaultGlucose: GlucoseEntry[] = [
  { date: daysAgoISO(6), value: 7.2 },
  { date: daysAgoISO(5), value: 6.8 },
  { date: daysAgoISO(4), value: 7.5 },
  { date: daysAgoISO(3), value: 6.4 },
  { date: daysAgoISO(2), value: 6.9 },
  { date: daysAgoISO(1), value: 6.1 },
  { date: todayISO(), value: 6.5 },
];

const defaultHbA1c: HbA1cEntry[] = [
  { date: daysAgoISO(180), value: 8.2 },
  { date: daysAgoISO(120), value: 7.8 },
  { date: daysAgoISO(60), value: 7.4 },
  { date: daysAgoISO(3), value: 7.1 },
];

const doctors = [
  { name: "陳家明醫生", specialty: "家庭科醫生", hospital: "瑪麗醫院", available: true, wait: "約5分鐘", rating: 4.9, reviews: 312, initials: "陳", bg: "#007AFF" },
  { name: "李素芬醫生", specialty: "內分泌科 · 糖尿病專科", hospital: "威爾斯親王醫院", available: true, wait: "約12分鐘", rating: 4.8, reviews: 241, initials: "李", bg: "#34C759" },
  { name: "黃志強醫生", specialty: "心臟科 · 高血壓專科", hospital: "廣華醫院", available: false, wait: "明日上午可預約", rating: 4.7, reviews: 189, initials: "黃", bg: "#8E8E93" },
];

const quickPrompts = ["我今日血壓好高", "血糖偏低點算", "忘記食藥點辦", "腳部麻痺"];

declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

// ── Shared UI components ──────────────────────────────────────────────────────
function StatusBar() {
  const [time, setTime] = useState(new Date().toLocaleTimeString("zh-HK", { hour: "2-digit", minute: "2-digit" }));
  useEffect(() => {
    const t = setInterval(() => setTime(new Date().toLocaleTimeString("zh-HK", { hour: "2-digit", minute: "2-digit" })), 10000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex items-center justify-between px-6 pt-3 pb-1 bg-card/80 backdrop-blur-xl" style={{ WebkitBackdropFilter: "blur(20px)" }}>
      <span className="text-base font-bold text-foreground tracking-tight">{time}</span>
      <div className="flex items-center gap-1.5">
        <Signal className="w-4 h-4 text-foreground" />
        <Wifi className="w-4 h-4 text-foreground" />
        <Battery className="w-5 h-5 text-foreground" />
      </div>
    </div>
  );
}

// Accessible colour tokens for 長者用家模式 (elder/patient mode) — darker
// variants of the brand palette chosen to clear WCAG AA (4.5:1) or AAA (7:1)
// contrast against white. Measured contrast ratios of the default brand
// colours against white: #007AFF ≈ 4.0:1, #FF3B30 ≈ 3.55:1, #8E8E93 ≈ 2.5:1 —
// all fail plain-text AA (4.5:1), which is unacceptable for elderly/low-vision
// users even though they pass at large-text-only AA (3:1). Carer mode keeps
// the original brand palette; these only apply where mode === "user".
const ELDER_BLUE = "#0051D4"; // ~6.7:1 vs white
const ELDER_RED = "#B00020"; // ~7.3:1 vs white (same red Material Design uses for its accessible "error" token)
const ELDER_MUTED = "#48484A"; // ~8.8:1 vs white, replaces #8E8E93 (~2.5:1, fails AA outright)
const ELDER_FOCUS_RING = "focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#0051D4]";

function NavBar({ title, large = false, elder = false, rightEl }: { title: string; large?: boolean; elder?: boolean; rightEl?: React.ReactNode }) {
  return (
    <div className="bg-card/80 backdrop-blur-xl border-b border-border px-4 pb-3 flex items-end justify-between" style={{ WebkitBackdropFilter: "blur(20px)" }}>
      {large
        ? <h1 className="text-[34px] font-bold text-foreground tracking-tight leading-tight">{title}</h1>
        : <h1 className={`flex-1 font-bold text-foreground text-center ${elder ? "text-[26px]" : "text-[17px] font-semibold"}`}>{title}</h1>
      }
      {rightEl && <div className="ml-2">{rightEl}</div>}
    </div>
  );
}

// Carer mode gets the full tab bar (including 掃描 OCR scanning); 醫療 and 測試
// stay reachable from Settings rather than crowding the bar further. User
// mode is deliberately down to home/chat only — see the V2 design brief.
// User mode also gets larger touch targets/labels/contrast (WCAG AA++, elder
// usability) since this bar is permanently on-screen during the redesigned
// accessible chat — see the Chat tab below for the full rationale.
function TabBar({ active, onChange, mode }: { active: Tab; onChange: (t: Tab) => void; mode: Mode }) {
  const carerTabs = [
    { id: "home" as Tab, label: "主頁", icon: Home },
    { id: "chat" as Tab, label: "對話", icon: MessageCircle },
    { id: "medications" as Tab, label: "藥物", icon: Pill },
    { id: "records" as Tab, label: "記錄", icon: TrendingUp },
    { id: "scan" as Tab, label: "掃描", icon: Camera },
    { id: "settings" as Tab, label: "設定", icon: Settings },
  ];
  const userTabs = [
    { id: "home" as Tab, label: "主頁", icon: Home },
    { id: "chat" as Tab, label: "對話", icon: MessageCircle },
  ];
  const elder = mode === "user";
  const tabs = elder ? userTabs : carerTabs;
  const activeColor = elder ? ELDER_BLUE : "#007AFF";
  const inactiveColor = elder ? ELDER_MUTED : "#8E8E93";
  return (
    <div className="flex border-t bg-card/90 backdrop-blur-xl pb-safe" style={{ borderColor: "rgba(60,60,67,0.18)", WebkitBackdropFilter: "blur(20px)" }}>
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          aria-current={active === t.id ? "page" : undefined}
          className={`flex-1 flex flex-col items-center gap-1 transition-opacity ${elder ? `py-3 ${ELDER_FOCUS_RING}` : "py-1.5"}`}
        >
          <t.icon className={elder ? "w-8 h-8 transition-colors" : "w-5 h-5 transition-colors"} style={{ color: active === t.id ? activeColor : inactiveColor }} strokeWidth={active === t.id ? 2.5 : 1.8} />
          <span className={`font-bold ${elder ? "text-[16px]" : "text-[9px] font-semibold"}`} style={{ color: active === t.id ? activeColor : inactiveColor }}>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

function Section({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div>
      {label && <p className="text-[13px] font-semibold uppercase px-4 pb-1.5" style={{ color: "#8E8E93", letterSpacing: "0.03em" }}>{label}</p>}
      <div className="bg-card mx-4 rounded-[12px] overflow-hidden" style={{ boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" }}>
        {children}
      </div>
    </div>
  );
}

function Cell({ icon, iconBg, label, sublabel, right, onPress, last = false, danger = false }: {
  icon?: React.ReactNode; iconBg?: string; label: string; sublabel?: string;
  right?: React.ReactNode; onPress?: () => void; last?: boolean; danger?: boolean;
}) {
  return (
    <button className={`w-full flex items-center gap-3 px-4 py-3 text-left active:bg-gray-100 transition-colors ${!last ? "border-b" : ""}`}
      style={{ borderColor: "rgba(60,60,67,0.12)" }} onClick={onPress}>
      {icon && <div className="w-9 h-9 rounded-[8px] flex items-center justify-center flex-shrink-0" style={{ backgroundColor: iconBg }}>{icon}</div>}
      <div className="flex-1 min-w-0">
        <p className={`text-[17px] leading-snug ${danger ? "text-[#FF3B30]" : "text-foreground"}`}>{label}</p>
        {sublabel && <p className="text-[13px] mt-0.5" style={{ color: "#8E8E93" }}>{sublabel}</p>}
      </div>
      {right ?? <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: "#C7C7CC" }} />}
    </button>
  );
}

// ── Mode Selection Landing ─────────────────────────────────────────────────────
function ModeLanding({ onSelect }: { onSelect: (m: Mode) => void }) {
  return (
    <div className="flex-1 flex flex-col bg-background overflow-hidden">
      <div className="flex flex-col items-center pt-10 pb-8 px-6"
        style={{ background: "linear-gradient(180deg, #007AFF 0%, #0055D4 100%)" }}>
        <div className="w-20 h-20 rounded-[22px] bg-white/20 flex items-center justify-center mb-4 shadow-lg">
          <Activity className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-[28px] font-bold text-white text-center leading-tight">健康伴侶</h1>
        <p className="text-white/70 text-[15px] text-center mt-1">香港長者健康管理平台</p>
      </div>

      <div className="flex-1 px-5 py-6 space-y-4 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
        <p className="text-[13px] font-semibold text-center uppercase mb-2" style={{ color: "#8E8E93", letterSpacing: "0.05em" }}>請選擇使用模式</p>

        {/* Carer mode */}
        <button onClick={() => onSelect("carer")}
          className="w-full text-left bg-card rounded-[20px] p-5 border-2 border-transparent active:opacity-80 transition-all"
          style={{ boxShadow: "0 4px 24px rgba(0,122,255,0.14), 0 0 0 0.5px rgba(60,60,67,0.12)" }}>
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-[14px] flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #007AFF, #5AC8FA)" }}>
              <Stethoscope className="w-7 h-7 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-[20px] font-bold text-foreground">照顧者模式</p>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#007AFF]/10 text-[#007AFF]">完整功能</span>
              </div>
              <p className="text-[14px] leading-relaxed" style={{ color: "#8E8E93" }}>適合家屬、護理員及醫護人員使用</p>
              <div className="mt-3 space-y-1.5">
                {["藥物管理與提醒", "健康數據圖表", "醫院文件掃描 (OCR)", "即時醫療諮詢", "完整設定"].map(f => (
                  <div key={f} className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-[#007AFF] flex-shrink-0" strokeWidth={3} />
                    <p className="text-[13px] text-foreground">{f}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-4 w-full py-3 rounded-[12px] text-center text-[15px] font-semibold text-white"
            style={{ background: "linear-gradient(135deg, #007AFF, #5AC8FA)" }}>
            以照顧者身份進入
          </div>
        </button>

        {/* User mode */}
        <button onClick={() => onSelect("user")}
          className="w-full text-left bg-card rounded-[20px] p-5 border-2 border-transparent active:opacity-80 transition-all"
          style={{ boxShadow: "0 4px 24px rgba(255,149,0,0.12), 0 0 0 0.5px rgba(60,60,67,0.12)" }}>
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-[14px] flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #FF9500, #FF6D00)" }}>
              <User className="w-7 h-7 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-[20px] font-bold text-foreground">長者用家模式</p>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#FF9500]/10 text-[#FF9500]">簡化介面</span>
              </div>
              <p className="text-[14px] leading-relaxed" style={{ color: "#8E8E93" }}>適合長者自行使用，介面簡單易明</p>
              <div className="mt-3 space-y-1.5">
                {["大字體顯示", "AI 語音健康助理", "一鍵緊急求助"].map(f => (
                  <div key={f} className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-[#FF9500] flex-shrink-0" strokeWidth={3} />
                    <p className="text-[13px] text-foreground">{f}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-4 w-full py-3 rounded-[12px] text-center text-[15px] font-semibold text-white"
            style={{ background: "linear-gradient(135deg, #FF9500, #FF6D00)" }}>
            以長者身份進入
          </div>
        </button>

        <p className="text-center text-[12px] pb-2" style={{ color: "#C7C7CC" }}>
          重新載入應用程式即可切換模式
        </p>
      </div>
    </div>
  );
}

// ── Onboarding / Landing Page ─────────────────────────────────────────────────
function OnboardingPage({ onDone }: { onDone: (p: Profile) => void }) {
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState<"男" | "女" | "">("");
  const [step, setStep] = useState<"welcome" | "form">("welcome");
  const valid = name.trim().length > 0 && age.trim().length > 0 && gender !== "";

  if (step === "welcome") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-8 bg-background">
        <div className="w-24 h-24 rounded-[26px] bg-[#007AFF] flex items-center justify-center mb-6 shadow-lg" style={{ boxShadow: "0 12px 40px rgba(0,122,255,0.4)" }}>
          <Activity className="w-12 h-12 text-white" />
        </div>
        <h1 className="text-[34px] font-bold text-foreground text-center leading-tight mb-3">健康伴侶</h1>
        <p className="text-[17px] text-center mb-2" style={{ color: "#8E8E93" }}>您的私人健康助理</p>
        <p className="text-[15px] text-center mb-10 leading-relaxed" style={{ color: "#8E8E93" }}>
          專為香港長者設計，協助管理<br />高血壓及糖尿病
        </p>
        <div className="w-full space-y-3 mb-6">
          {["💊 藥物提醒", "🩺 即時醫療諮詢", "📊 健康數據記錄", "🤖 AI 健康助理"].map(f => (
            <div key={f} className="flex items-center gap-3 px-5 py-3.5 bg-card rounded-[14px]" style={{ boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" }}>
              <p className="text-[17px] text-foreground">{f}</p>
            </div>
          ))}
        </div>
        <button
          onClick={() => setStep("form")}
          className="w-full py-4 rounded-[14px] text-white text-[17px] font-semibold"
          style={{ background: "linear-gradient(135deg, #007AFF, #5AC8FA)" }}
        >
          開始設定
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col px-6 bg-background overflow-y-auto" style={{ scrollbarWidth: "none" }}>
      <div className="pt-6 pb-4">
        <h2 className="text-[28px] font-bold text-foreground leading-tight">個人資料</h2>
        <p className="text-[15px] mt-1" style={{ color: "#8E8E93" }}>請填寫您的基本資料，方便助理為您提供更個人化的建議</p>
      </div>

      {/* Avatar placeholder */}
      <div className="flex justify-center mb-6">
        <div className="w-20 h-20 rounded-full bg-[#007AFF]/10 border-2 border-[#007AFF]/30 flex items-center justify-center">
          <User className="w-10 h-10 text-[#007AFF]" />
        </div>
      </div>

      {/* Name */}
      <div className="mb-5">
        <p className="text-[13px] font-semibold uppercase mb-1.5 px-1" style={{ color: "#8E8E93", letterSpacing: "0.04em" }}>姓名</p>
        <div className="bg-card rounded-[12px] px-4 py-3.5" style={{ boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" }}>
          <input
            className="w-full text-[17px] text-foreground bg-transparent outline-none placeholder:text-[#C7C7CC]"
            placeholder="例：陳婆婆"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
      </div>

      {/* Age */}
      <div className="mb-5">
        <p className="text-[13px] font-semibold uppercase mb-1.5 px-1" style={{ color: "#8E8E93", letterSpacing: "0.04em" }}>年齡</p>
        <div className="bg-card rounded-[12px] px-4 py-3.5" style={{ boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" }}>
          <input
            className="w-full text-[17px] text-foreground bg-transparent outline-none placeholder:text-[#C7C7CC]"
            placeholder="例：72"
            type="number"
            inputMode="numeric"
            value={age}
            onChange={e => setAge(e.target.value)}
          />
        </div>
      </div>

      {/* Gender segmented control */}
      <div className="mb-8">
        <p className="text-[13px] font-semibold uppercase mb-1.5 px-1" style={{ color: "#8E8E93", letterSpacing: "0.04em" }}>性別</p>
        <div className="bg-card rounded-[12px] p-1.5 flex gap-1.5" style={{ boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" }}>
          {(["男", "女"] as const).map(g => (
            <button
              key={g}
              onClick={() => setGender(g)}
              className="flex-1 py-2.5 rounded-[9px] text-[15px] font-semibold transition-all"
              style={{
                backgroundColor: gender === g ? "#007AFF" : "transparent",
                color: gender === g ? "#fff" : "#8E8E93",
              }}
            >
              {g === "男" ? "👨 男性" : "👩 女性"}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={() => valid && onDone({ name: name.trim(), age, gender })}
        disabled={!valid}
        className="w-full py-4 rounded-[14px] text-white text-[17px] font-semibold mb-8 transition-opacity disabled:opacity-40"
        style={{ background: "linear-gradient(135deg, #007AFF, #5AC8FA)" }}
      >
        完成設定
      </button>
    </div>
  );
}

// ── Add BP Modal ──────────────────────────────────────────────────────────────
// Shared date field — used by all three record modals. Defaults to today,
// but can be backdated (e.g. logging yesterday's reading you forgot).
function DateField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <p className="text-[13px] font-semibold uppercase mb-1 px-1" style={{ color: "#8E8E93", letterSpacing: "0.04em" }}>日期</p>
      <div className="bg-[#F2F2F7] rounded-[12px] px-4 py-3">
        <input
          type="date"
          className="w-full text-[17px] text-foreground bg-transparent outline-none"
          value={value}
          max={todayISO()}
          onChange={e => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}

function BPModal({ initial, onSave, onClose }: { initial?: BPEntry; onSave: (e: BPEntry) => void; onClose: () => void }) {
  const isEdit = !!initial;
  const [date, setDate] = useState(initial?.date ?? todayISO());
  const [sys, setSys] = useState(initial ? String(initial.sys) : "");
  const [dia, setDia] = useState(initial ? String(initial.dia) : "");
  const valid = date && sys.trim() && dia.trim() && Number(sys) > 0 && Number(dia) > 0;
  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end bg-black/50 backdrop-blur-sm">
      <div className="bg-card rounded-t-[20px] px-6 pt-5 pb-8">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-[20px] font-bold text-foreground">{isEdit ? "修改血壓記錄" : "新增血壓記錄"}</h3>
          <button onClick={onClose}><X className="w-6 h-6" style={{ color: "#8E8E93" }} /></button>
        </div>
        <div className="space-y-4">
          <DateField value={date} onChange={setDate} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[13px] font-semibold uppercase mb-1 px-1" style={{ color: "#8E8E93", letterSpacing: "0.04em" }}>收縮壓 (mmHg)</p>
              <div className="bg-[#F2F2F7] rounded-[12px] px-4 py-3">
                <input className="w-full text-[17px] text-foreground bg-transparent outline-none placeholder:text-[#C7C7CC]"
                  placeholder="例：130" type="number" inputMode="numeric" value={sys} onChange={e => setSys(e.target.value)} />
              </div>
            </div>
            <div>
              <p className="text-[13px] font-semibold uppercase mb-1 px-1" style={{ color: "#8E8E93", letterSpacing: "0.04em" }}>舒張壓 (mmHg)</p>
              <div className="bg-[#F2F2F7] rounded-[12px] px-4 py-3">
                <input className="w-full text-[17px] text-foreground bg-transparent outline-none placeholder:text-[#C7C7CC]"
                  placeholder="例：80" type="number" inputMode="numeric" value={dia} onChange={e => setDia(e.target.value)} />
              </div>
            </div>
          </div>
        </div>
        <button
          onClick={() => { if (valid) { onSave({ id: initial?.id, date, sys: Number(sys), dia: Number(dia) }); onClose(); } }}
          disabled={!valid}
          className="w-full py-4 rounded-[14px] text-white text-[17px] font-semibold mt-5 disabled:opacity-40 transition-opacity"
          style={{ backgroundColor: "#007AFF" }}
        >
          {isEdit ? "更新記錄" : "儲存記錄"}
        </button>
      </div>
    </div>
  );
}

function GlucoseModal({ initial, onSave, onClose }: { initial?: GlucoseEntry; onSave: (e: GlucoseEntry) => void; onClose: () => void }) {
  const isEdit = !!initial;
  const [date, setDate] = useState(initial?.date ?? todayISO());
  const [val, setVal] = useState(initial ? String(initial.value) : "");
  const valid = date && val.trim() && Number(val) > 0;
  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end bg-black/50 backdrop-blur-sm">
      <div className="bg-card rounded-t-[20px] px-6 pt-5 pb-8">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-[20px] font-bold text-foreground">{isEdit ? "修改血糖記錄" : "新增血糖記錄"}</h3>
          <button onClick={onClose}><X className="w-6 h-6" style={{ color: "#8E8E93" }} /></button>
        </div>
        <div className="space-y-4">
          <DateField value={date} onChange={setDate} />
          <div>
            <p className="text-[13px] font-semibold uppercase mb-1 px-1" style={{ color: "#8E8E93", letterSpacing: "0.04em" }}>血糖 (mmol/L)</p>
            <div className="bg-[#F2F2F7] rounded-[12px] px-4 py-3">
              <input className="w-full text-[17px] text-foreground bg-transparent outline-none placeholder:text-[#C7C7CC]"
                placeholder="例：6.5" type="number" inputMode="decimal" step="0.1" value={val} onChange={e => setVal(e.target.value)} />
            </div>
            <p className="text-[13px] mt-1.5 px-1" style={{ color: "#8E8E93" }}>目標：空腹 4.0 – 7.0 mmol/L</p>
          </div>
        </div>
        <button
          onClick={() => { if (valid) { onSave({ id: initial?.id, date, value: Number(val) }); onClose(); } }}
          disabled={!valid}
          className="w-full py-4 rounded-[14px] text-white text-[17px] font-semibold mt-5 disabled:opacity-40 transition-opacity"
          style={{ backgroundColor: "#5AC8FA" }}
        >
          {isEdit ? "更新記錄" : "儲存記錄"}
        </button>
      </div>
    </div>
  );
}

function HbA1cModal({ initial, onSave, onClose }: { initial?: HbA1cEntry; onSave: (e: HbA1cEntry) => void; onClose: () => void }) {
  const isEdit = !!initial;
  const [date, setDate] = useState(initial?.date ?? todayISO());
  const [val, setVal] = useState(initial ? String(initial.value) : "");
  const valid = date && val.trim() && Number(val) > 0;
  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end bg-black/50 backdrop-blur-sm">
      <div className="bg-card rounded-t-[20px] px-6 pt-5 pb-8">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-[20px] font-bold text-foreground">{isEdit ? "修改 HbA1c 記錄" : "新增 HbA1c 記錄"}</h3>
          <button onClick={onClose}><X className="w-6 h-6" style={{ color: "#8E8E93" }} /></button>
        </div>
        <div className="space-y-4">
          <DateField value={date} onChange={setDate} />
          <div>
            <p className="text-[13px] font-semibold uppercase mb-1 px-1" style={{ color: "#8E8E93", letterSpacing: "0.04em" }}>HbA1c 數值 (%)</p>
            <div className="bg-[#F2F2F7] rounded-[12px] px-4 py-3">
              <input className="w-full text-[17px] text-foreground bg-transparent outline-none placeholder:text-[#C7C7CC]"
                placeholder="例：7.2" type="number" inputMode="decimal" step="0.1" value={val} onChange={e => setVal(e.target.value)} />
            </div>
            <p className="text-[13px] mt-1.5 px-1" style={{ color: "#8E8E93" }}>目標：低於 7.0%（糖尿病控制良好）</p>
          </div>
        </div>
        <button
          onClick={() => { if (valid) { onSave({ id: initial?.id, date, value: Number(val) }); onClose(); } }}
          disabled={!valid}
          className="w-full py-4 rounded-[14px] text-white text-[17px] font-semibold mt-5 disabled:opacity-40 transition-opacity"
          style={{ backgroundColor: "#FF9500" }}
        >
          {isEdit ? "更新記錄" : "儲存記錄"}
        </button>
      </div>
    </div>
  );
}

// ── Custom chart tooltip ──────────────────────────────────────────────────────
function BPTooltip({ active, payload, label }: { active?: boolean; payload?: {value:number;name:string;color:string}[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card rounded-[10px] px-3 py-2 shadow-lg" style={{ boxShadow: "0 4px 20px rgba(0,0,0,0.12)" }}>
      <p className="text-[12px] font-semibold mb-1" style={{ color: "#8E8E93" }}>{label}</p>
      {payload.map(p => (
        <p key={p.name} className="text-[13px] font-bold" style={{ color: p.color }}>{p.name}: {p.value} mmHg</p>
      ))}
    </div>
  );
}
function GlucoseTooltip({ active, payload, label }: { active?: boolean; payload?: {value:number}[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card rounded-[10px] px-3 py-2 shadow-lg" style={{ boxShadow: "0 4px 20px rgba(0,0,0,0.12)" }}>
      <p className="text-[12px] font-semibold mb-1" style={{ color: "#8E8E93" }}>{label}</p>
      <p className="text-[13px] font-bold" style={{ color: "#5AC8FA" }}>血糖: {payload[0].value} mmol/L</p>
    </div>
  );
}
function HbA1cTooltip({ active, payload, label }: { active?: boolean; payload?: {value:number}[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card rounded-[10px] px-3 py-2 shadow-lg" style={{ boxShadow: "0 4px 20px rgba(0,0,0,0.12)" }}>
      <p className="text-[12px] font-semibold mb-1" style={{ color: "#8E8E93" }}>{label}</p>
      <p className="text-[13px] font-bold" style={{ color: "#FF9500" }}>HbA1c: {payload[0].value}%</p>
    </div>
  );
}

// ── OCR Scan Tab ──────────────────────────────────────────────────────────────
// Real backend: photographed document → POST /api/ocr/scan → local vision
// model (src/ocr.py, qwen2.5vl by default) reads + structures it. History is
// persisted server-side (GET /api/scans), not just kept in memory.
function ScanTab() {
  const [scanState, setScanState] = useState<"idle" | "processing" | "result" | "error">("idle");
  const [currentDoc, setCurrentDoc] = useState<ScannedDoc | null>(null);
  const [history, setHistory] = useState<ScannedDoc[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getScans().then(docs => setHistory([...docs].reverse())).catch(err => console.error("Failed to load scan history", err));
  }, []);

  async function handleCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPreviewUrl(URL.createObjectURL(file));
    setScanState("processing");
    setError(null);
    try {
      const doc = await scanDocument(file);
      setCurrentDoc(doc);
      setHistory(p => [doc, ...p]);
      setScanState("result");
    } catch (err) {
      console.error("OCR scan failed", err);
      setError(
        err instanceof Error && err.message.includes("502")
          ? "未能辨識文件。後台可能未安裝視覺模型 — 請喺電腦執行 `ollama pull qwen2.5vl:7b`。"
          : "未能連接後台伺服器，請檢查網絡連線後再試。"
      );
      setScanState("error");
    }
  }

  function reset() { setScanState("idle"); setCurrentDoc(null); setPreviewUrl(null); setError(null); }

  return (
    <>
      <NavBar title="文件掃描" large />
      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handleCapture} className="hidden" />

      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
        {/* Idle state */}
        {scanState === "idle" && (
          <div className="flex flex-col py-4 pb-6 space-y-5">
            <div className="mx-4 rounded-[20px] overflow-hidden" style={{ background: "linear-gradient(135deg, #1C1C2E 0%, #2C2C44 100%)" }}>
              <div className="flex flex-col items-center py-8 px-6">
                <div className="relative w-36 h-36 mb-5">
                  <div className="absolute inset-0 rounded-[16px] border-2 border-white/20" />
                  {[["top-0 left-0", "border-t-2 border-l-2"], ["top-0 right-0", "border-t-2 border-r-2"],
                    ["bottom-0 left-0", "border-b-2 border-l-2"], ["bottom-0 right-0", "border-b-2 border-r-2"]].map(([pos, b], i) => (
                    <div key={i} className={`absolute w-6 h-6 ${pos} ${b} border-[#007AFF] rounded-sm`} />
                  ))}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <FileText className="w-12 h-12 text-white/30" />
                  </div>
                  <div className="absolute left-2 right-2 h-0.5 bg-[#007AFF]/60 animate-bounce" style={{ top: "50%", animationDuration: "2s" }} />
                </div>
                <p className="text-white text-[18px] font-bold mb-1">掃描醫院文件</p>
                <p className="text-white/50 text-[13px] text-center leading-relaxed mb-5">
                  支援出院摘要、化驗報告<br />及藥物處方
                </p>
                <button onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-2 px-6 py-3.5 rounded-[14px] text-white text-[17px] font-semibold"
                  style={{ background: "linear-gradient(135deg, #007AFF, #5AC8FA)" }}>
                  <Camera className="w-5 h-5" />
                  開啟相機掃描
                </button>
              </div>
              <div className="flex border-t border-white/10">
                {[{ icon: ShieldCheck, label: "本機處理" }, { icon: Scan, label: "自動識別" }, { icon: FileText, label: "即時解讀" }].map((f, i, arr) => (
                  <div key={f.label} className={`flex-1 flex flex-col items-center py-3 gap-1 ${i < arr.length - 1 ? "border-r border-white/10" : ""}`}>
                    <f.icon className="w-4 h-4 text-[#007AFF]" />
                    <p className="text-[11px] text-white/50">{f.label}</p>
                  </div>
                ))}
              </div>
            </div>

            <Section label="支援文件類型">
              {[
                { label: "出院摘要", sublabel: "Hospital Authority Discharge Summary", color: "#007AFF" },
                { label: "化驗報告", sublabel: "Laboratory Test Report", color: "#34C759" },
                { label: "藥物處方", sublabel: "Prescription / 醫院配藥單", color: "#FF9500" },
                { label: "覆診通知", sublabel: "Outpatient Appointment Notice", color: "#FF2D55" },
              ].map((t, i, arr) => (
                <div key={t.label} className={`flex items-center gap-3 px-4 py-3 ${i < arr.length - 1 ? "border-b" : ""}`}
                  style={{ borderColor: "rgba(60,60,67,0.12)" }}>
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />
                  <div>
                    <p className="text-[15px] text-foreground">{t.label}</p>
                    <p className="text-[12px]" style={{ color: "#8E8E93" }}>{t.sublabel}</p>
                  </div>
                </div>
              ))}
            </Section>

            {history.length > 0 && (
              <Section label="最近掃描記錄">
                {history.map((doc, i) => (
                  <button key={doc.id} onClick={() => { setCurrentDoc(doc); setScanState("result"); }}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left ${i < history.length - 1 ? "border-b" : ""}`}
                    style={{ borderColor: "rgba(60,60,67,0.12)" }}>
                    <div className="w-9 h-9 rounded-[8px] bg-[#007AFF]/10 flex items-center justify-center flex-shrink-0">
                      <FileText className="w-5 h-5 text-[#007AFF]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] text-foreground">{doc.title}</p>
                      <p className="text-[12px] truncate" style={{ color: "#8E8E93" }}>{doc.issued}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: "#C7C7CC" }} />
                  </button>
                ))}
              </Section>
            )}
          </div>
        )}

        {/* Processing state */}
        {scanState === "processing" && (
          <div className="flex-1 flex flex-col items-center justify-center min-h-[500px] px-8 gap-6">
            {previewUrl && (
              <div className="w-48 h-56 rounded-[16px] overflow-hidden border-2 border-[#007AFF]/30 relative shadow-lg">
                <img src={previewUrl} alt="掃描中" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                  <div className="absolute left-0 right-0 h-0.5 bg-[#007AFF] shadow-[0_0_8px_#007AFF]"
                    style={{ animation: "scan-sweep 1.2s ease-in-out infinite", top: "30%" }} />
                </div>
              </div>
            )}
            <div className="flex flex-col items-center gap-3">
              <div className="w-14 h-14 rounded-full bg-[#007AFF]/10 flex items-center justify-center">
                <Loader className="w-7 h-7 text-[#007AFF] animate-spin" />
              </div>
              <p className="text-[20px] font-bold text-foreground">正在辨識文件…</p>
              <p className="text-[14px] text-center" style={{ color: "#8E8E93" }}>
                AI 正在本機分析文件內容<br />可能需要10-20秒，請稍候
              </p>
            </div>
          </div>
        )}

        {/* Error state */}
        {scanState === "error" && (
          <div className="flex-1 flex flex-col items-center justify-center min-h-[500px] px-8 gap-5 text-center">
            <div className="w-16 h-16 rounded-full bg-[#FF9500]/10 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-[#FF9500]" />
            </div>
            <p className="text-[18px] font-bold text-foreground">未能辨識文件</p>
            <p className="text-[14px] leading-relaxed" style={{ color: "#8E8E93" }}>{error}</p>
            <button onClick={reset} className="px-6 py-3 rounded-[14px] text-[#007AFF] text-[15px] font-semibold" style={{ backgroundColor: "#F2F2F7" }}>
              重新嘗試
            </button>
          </div>
        )}

        {/* Result state */}
        {scanState === "result" && currentDoc && (
          <div className="py-4 pb-8 space-y-4">
            <div className="mx-4 flex items-center gap-3 px-4 py-3.5 rounded-[14px]" style={{ backgroundColor: "#34C75912", border: "1px solid #34C75930" }}>
              <Check className="w-5 h-5 text-[#34C759] flex-shrink-0" strokeWidth={3} />
              <div>
                <p className="text-[15px] font-semibold text-[#34C759]">文件辨識成功</p>
                <p className="text-[12px]" style={{ color: "#34C759" }}>內容已由本機AI提取，未上傳雲端</p>
              </div>
              <button onClick={reset} className="ml-auto">
                <X className="w-4 h-4" style={{ color: "#8E8E93" }} />
              </button>
            </div>

            <div className="mx-4 bg-[#007AFF] rounded-[16px] p-5">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 bg-white/20 rounded-[10px] flex items-center justify-center flex-shrink-0">
                  <FileText className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="text-white/70 text-[12px] font-medium">醫院管理局</p>
                  <p className="text-white text-[20px] font-bold leading-tight">{currentDoc.title}</p>
                  <p className="text-white/70 text-[13px] mt-1">病人：{currentDoc.patient}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="bg-white/10 rounded-[10px] px-3 py-2">
                  <p className="text-white/60 text-[11px]">病人編號</p>
                  <p className="text-white text-[13px] font-semibold">{currentDoc.pid}</p>
                </div>
                <div className="bg-white/10 rounded-[10px] px-3 py-2">
                  <p className="text-white/60 text-[11px]">發出日期</p>
                  <p className="text-white text-[13px] font-semibold">{currentDoc.issued}</p>
                </div>
              </div>
            </div>

            {currentDoc.sections.map(sec => (
              <Section key={sec.label} label={sec.label}>
                {sec.items.map((item, i) => (
                  <div key={i} className={`px-4 py-3 flex items-start gap-3 ${i < sec.items.length - 1 ? "border-b" : ""}`}
                    style={{ borderColor: "rgba(60,60,67,0.12)" }}>
                    <div className="w-1.5 h-1.5 rounded-full bg-[#007AFF] flex-shrink-0 mt-2" />
                    <p className="text-[15px] text-foreground leading-snug">{item}</p>
                  </div>
                ))}
              </Section>
            ))}

            <div className="px-4 space-y-3">
              <button onClick={() => fileRef.current?.click()}
                className="w-full py-4 rounded-[14px] text-white text-[17px] font-semibold flex items-center justify-center gap-2"
                style={{ background: "linear-gradient(135deg, #007AFF, #5AC8FA)" }}>
                <Camera className="w-5 h-5" />
                掃描另一份文件
              </button>
              <button onClick={reset} className="w-full py-3.5 rounded-[14px] text-[17px] font-semibold text-[#007AFF]"
                style={{ backgroundColor: "#F2F2F7" }}>
                返回
              </button>
            </div>
          </div>
        )}
      </div>
      <style>{`
        @keyframes scan-sweep {
          0% { top: 10%; } 50% { top: 85%; } 100% { top: 10%; }
        }
      `}</style>
    </>
  );
}

// ── Settings Tab ─────────────────────────────────────────────────────────────
function SettingsTab({
  profile, mode, onSave, onOpenTab, onSwitchMode,
  modelsResponse, modelsLoading, modelsError, modelSwitching, onSelectModel, onRetryModels, onSaveApiKey,
}: {
  profile: Profile; mode: Mode; onSave: (p: Profile) => void; onOpenTab: (t: Tab) => void; onSwitchMode: () => void;
  modelsResponse: ModelsResponse | null; modelsLoading: boolean; modelsError: string | null; modelSwitching: boolean;
  onSelectModel: (provider: string, model: string) => void; onRetryModels: () => void;
  onSaveApiKey: (provider: string, apiKey: string) => Promise<void>;
}) {
  const [name, setName] = useState(profile.name);
  const [age, setAge] = useState(profile.age);
  const [gender, setGender] = useState<"男" | "女" | "">(profile.gender);
  const [saved, setSaved] = useState(false);
  const dirty = name !== profile.name || age !== profile.age || gender !== profile.gender;
  const valid = name.trim().length > 0 && age.trim().length > 0 && gender !== "";

  function handleSave() {
    if (!valid) return;
    onSave({ name: name.trim(), age, gender });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <>
      <NavBar title="設定" large />
      <div className="flex-1 overflow-y-auto py-4 space-y-6" style={{ scrollbarWidth: "none" }}>

        {/* Saved banner */}
        <div
          className="mx-4 flex items-center gap-2 px-4 py-3 rounded-[12px] transition-all duration-300 overflow-hidden"
          style={{
            backgroundColor: "#34C75918",
            maxHeight: saved ? 52 : 0,
            opacity: saved ? 1 : 0,
            padding: saved ? undefined : "0 16px",
          }}
        >
          <Check className="w-4 h-4 text-[#34C759] flex-shrink-0" strokeWidth={3} />
          <p className="text-[15px] font-semibold text-[#34C759]">個人資料已更新</p>
        </div>

        {/* Avatar */}
        <div className="flex flex-col items-center gap-3 pt-2">
          <div className="w-24 h-24 rounded-full bg-[#007AFF] flex items-center justify-center shadow-lg"
            style={{ boxShadow: "0 8px 24px rgba(0,122,255,0.35)" }}>
            <span className="text-white text-[40px] font-bold leading-none">{name.charAt(0) || "?"}</span>
          </div>
          <div className="text-center">
            <p className="text-[20px] font-bold text-foreground">{profile.name}</p>
            <p className="text-[14px]" style={{ color: "#8E8E93" }}>{profile.age} 歲 · {profile.gender}性</p>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full" style={{ backgroundColor: "#007AFF18" }}>
            <Stethoscope className="w-3.5 h-3.5 text-[#007AFF]" />
            <p className="text-[12px] font-semibold text-[#007AFF]">照顧者模式</p>
          </div>
        </div>

        {/* More features — kept out of the bottom tab bar to avoid crowding it */}
        <Section label="更多功能">
          <Cell icon={<Stethoscope className="w-5 h-5 text-white" />} iconBg="#5AC8FA"
            label="醫療諮詢" sublabel="預約視訊問診" onPress={() => onOpenTab("consult")} />
          <Cell icon={<ShieldCheck className="w-5 h-5 text-white" />} iconBg="#34C759"
            label="測試同評估" sublabel="LLM準確度／幻覺報告" onPress={() => onOpenTab("eval")} last />
        </Section>

        {/* AI model selection — which chat LLM the whole app talks to (see
            src/providers.py). Options whose API key isn't configured on the
            backend are shown but disabled, with the env var name, rather than
            hidden — so it's clear the option exists but needs setup. */}
        <div className="space-y-1">
          <p className="text-[13px] font-semibold uppercase px-4 pb-1" style={{ color: "#8E8E93", letterSpacing: "0.04em" }}>
            AI 模型
          </p>
          {modelsLoading && (
            <div className="bg-card mx-4 rounded-[12px] p-6 text-center" style={{ boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" }}>
              <RefreshCw className="w-5 h-5 mx-auto mb-2 animate-spin" style={{ color: "#007AFF" }} />
              <p className="text-[13px]" style={{ color: "#8E8E93" }}>載入緊模型清單…</p>
            </div>
          )}
          {!modelsLoading && modelsError && (
            <div className="bg-card mx-4 rounded-[12px] p-4 text-center" style={{ boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" }}>
              <p className="text-[13px] text-foreground mb-2">{modelsError}</p>
              <button onClick={onRetryModels} className="text-[13px] font-semibold" style={{ color: "#007AFF" }}>重試</button>
            </div>
          )}
          {!modelsLoading && !modelsError && modelsResponse && (
            <div className="bg-card mx-4 rounded-[12px] overflow-hidden" style={{ boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" }}>
              {modelsResponse.providers.map((p, pi) => (
                <div key={p.id} className={pi < modelsResponse.providers.length - 1 ? "border-b" : ""} style={{ borderColor: "rgba(60,60,67,0.12)" }}>
                  <div className="px-4 pt-3 pb-1 flex items-center justify-between">
                    <p className="text-[13px] font-semibold text-foreground">{p.label}</p>
                    {!p.available && p.needs_key && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ color: "#FF9500", backgroundColor: "#FF950018" }}>
                        未設定 {p.needs_key}
                      </span>
                    )}
                  </div>
                  {!p.available && p.needs_key && (
                    <ApiKeyEntry providerId={p.id} needsKey={p.needs_key} onSave={onSaveApiKey} />
                  )}
                  {p.models.map(m => {
                    const active = modelsResponse.current.provider === p.id && modelsResponse.current.model === m.id;
                    return (
                      <button
                        key={m.id}
                        disabled={!p.available || modelSwitching}
                        onClick={() => onSelectModel(p.id, m.id)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-left disabled:opacity-40"
                      >
                        <Cpu className="w-4 h-4 flex-shrink-0" style={{ color: active ? "#007AFF" : "#8E8E93" }} />
                        <span className="flex-1 text-[15px]" style={{ color: active ? "#007AFF" : "var(--foreground)", fontWeight: active ? 600 : 400 }}>
                          {m.label}
                        </span>
                        {active && <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: "#007AFF" }} />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
          <p className="mx-4 text-[12px]" style={{ color: "#8E8E93" }}>
            揀選之後，所有對話同「測試同評估」重新運行都會用返呢個模型。API金鑰要喺後台 <code>.env</code> 設定。
          </p>
        </div>

        {/* Switch to the simplified elderly-user view before handing the phone over */}
        <Section label="使用模式">
          <Cell icon={<User className="w-5 h-5 text-white" />} iconBg="#FF9500"
            label="切換至長者用家模式" sublabel="簡化介面：只顯示主頁同對話"
            onPress={onSwitchMode} last />
        </Section>

        {/* Personal info form */}
        <div className="space-y-1">
          <p className="text-[13px] font-semibold uppercase px-4 pb-1" style={{ color: "#8E8E93", letterSpacing: "0.04em" }}>個人資料</p>
          <div className="bg-card mx-4 rounded-[12px] overflow-hidden" style={{ boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" }}>
            {/* Name row */}
            <div className="flex items-center gap-3 px-4 py-3.5 border-b" style={{ borderColor: "rgba(60,60,67,0.12)" }}>
              <div className="w-9 h-9 rounded-[8px] bg-[#007AFF] flex items-center justify-center flex-shrink-0">
                <User className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold mb-0.5" style={{ color: "#8E8E93" }}>姓名</p>
                <input
                  className="w-full text-[17px] text-foreground bg-transparent outline-none placeholder:text-[#C7C7CC]"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="請輸入姓名"
                />
              </div>
            </div>
            {/* Age row */}
            <div className="flex items-center gap-3 px-4 py-3.5 border-b" style={{ borderColor: "rgba(60,60,67,0.12)" }}>
              <div className="w-9 h-9 rounded-[8px] flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#FF9500" }}>
                <span className="text-white text-[15px] font-bold">歲</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold mb-0.5" style={{ color: "#8E8E93" }}>年齡</p>
                <input
                  className="w-full text-[17px] text-foreground bg-transparent outline-none placeholder:text-[#C7C7CC]"
                  value={age}
                  onChange={e => setAge(e.target.value)}
                  placeholder="請輸入年齡"
                  type="number"
                  inputMode="numeric"
                />
              </div>
            </div>
            {/* Gender row */}
            <div className="flex items-center gap-3 px-4 py-3.5">
              <div className="w-9 h-9 rounded-[8px] flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#FF2D55" }}>
                <Heart className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold mb-2" style={{ color: "#8E8E93" }}>性別</p>
                <div className="flex gap-2">
                  {(["男", "女"] as const).map(g => (
                    <button
                      key={g}
                      onClick={() => setGender(g)}
                      className="flex-1 py-2 rounded-[9px] text-[14px] font-semibold transition-all"
                      style={{
                        backgroundColor: gender === g ? "#007AFF" : "#F2F2F7",
                        color: gender === g ? "#fff" : "#8E8E93",
                      }}
                    >
                      {g === "男" ? "👨 男性" : "👩 女性"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Medical profile (read-only info) */}
        <div className="space-y-1">
          <p className="text-[13px] font-semibold uppercase px-4 pb-1" style={{ color: "#8E8E93", letterSpacing: "0.04em" }}>病歷資料</p>
          <div className="bg-card mx-4 rounded-[12px] overflow-hidden" style={{ boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" }}>
            {[
              { label: "慢性病", value: "高血壓、2型糖尿病", color: "#007AFF" },
              { label: "主診醫生", value: "李家輝醫生", color: "#34C759" },
              { label: "診所", value: "瑪麗醫院內科部", color: "#FF9500" },
            ].map((row, i, arr) => (
              <div key={row.label} className={`flex items-center justify-between px-4 py-3.5 ${i < arr.length - 1 ? "border-b" : ""}`}
                style={{ borderColor: "rgba(60,60,67,0.12)" }}>
                <p className="text-[15px] text-foreground">{row.label}</p>
                <p className="text-[15px] font-medium" style={{ color: row.color }}>{row.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Emergency contacts */}
        <div className="space-y-1">
          <p className="text-[13px] font-semibold uppercase px-4 pb-1" style={{ color: "#8E8E93", letterSpacing: "0.04em" }}>緊急聯絡人</p>
          <div className="bg-card mx-4 rounded-[12px] overflow-hidden" style={{ boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" }}>
            {[
              { name: "陳大明", role: "兒子", phone: "9123-4567" },
              { name: "李家輝醫生", role: "主治醫生", phone: "2345-6789" },
            ].map((c, i, arr) => (
              <div key={c.name} className={`flex items-center gap-3 px-4 py-3.5 ${i < arr.length - 1 ? "border-b" : ""}`}
                style={{ borderColor: "rgba(60,60,67,0.12)" }}>
                <div className="w-9 h-9 rounded-full bg-[#007AFF]/10 flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4 text-[#007AFF]" />
                </div>
                <div className="flex-1">
                  <p className="text-[15px] text-foreground">{c.name} <span className="text-[#8E8E93]">· {c.role}</span></p>
                  <p className="text-[13px]" style={{ color: "#8E8E93" }}>{c.phone}</p>
                </div>
                <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: "#C7C7CC" }} />
              </div>
            ))}
          </div>
        </div>

        {/* App info */}
        <div className="space-y-1">
          <p className="text-[13px] font-semibold uppercase px-4 pb-1" style={{ color: "#8E8E93", letterSpacing: "0.04em" }}>關於應用程式</p>
          <div className="bg-card mx-4 rounded-[12px] overflow-hidden" style={{ boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" }}>
            {[
              { label: "版本", value: "1.0.0" },
              { label: "語言", value: "廣東話（香港）" },
            ].map((row, i, arr) => (
              <div key={row.label} className={`flex items-center justify-between px-4 py-3.5 ${i < arr.length - 1 ? "border-b" : ""}`}
                style={{ borderColor: "rgba(60,60,67,0.12)" }}>
                <p className="text-[15px] text-foreground">{row.label}</p>
                <p className="text-[15px]" style={{ color: "#8E8E93" }}>{row.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Save button */}
        <div className="px-4 pb-4">
          <button
            onClick={handleSave}
            disabled={!dirty || !valid}
            className="w-full py-4 rounded-[14px] text-white text-[17px] font-semibold transition-all disabled:opacity-35"
            style={{ background: "linear-gradient(135deg, #007AFF, #5AC8FA)" }}
          >
            {saved ? "已儲存 ✓" : "儲存更改"}
          </button>
        </div>
      </div>
    </>
  );
}

// Pass-rate pill, used across the Testing tab
function RateBadge({ rate }: { rate: number }) {
  const color = rateColor(rate);
  return (
    <span
      className="text-[13px] font-bold px-2.5 py-1 rounded-full flex-shrink-0"
      style={{ color, backgroundColor: `${color}1A` }}
    >
      {Math.round(rate * 100)}%
    </span>
  );
}

// Hallucination-rate pill — inverted coloring from RateBadge (lower = better,
// see hallucinationRateColor).
function HallucinationRateBadge({ rate }: { rate: number }) {
  const color = hallucinationRateColor(rate);
  return (
    <span
      className="text-[13px] font-bold px-2.5 py-1 rounded-full flex-shrink-0"
      style={{ color, backgroundColor: `${color}1A` }}
    >
      {Math.round(rate * 100)}%
    </span>
  );
}

// Expandable "判斷 / 證據 / 理由" (claim / evidence / reasoning) panel shown
// under every graded case in the Testing tab — not just failures — so a PASS
// can be audited (what did the model actually claim, and what grounded it),
// not just trusted at face value.
function ClaimEvidenceReasoning({
  claim, evidence, reasoning, latencyMs,
}: { claim: string; evidence: string; reasoning: string; latencyMs?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-[12px] font-semibold"
        style={{ color: "#007AFF" }}
      >
        <ChevronDown className="w-3.5 h-3.5 transition-transform" style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }} />
        判斷、證據同理由
        {typeof latencyMs === "number" && (
          <span className="font-normal ml-1" style={{ color: "#8E8E93" }}>· {(latencyMs / 1000).toFixed(1)}s</span>
        )}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5 rounded-[10px] p-2.5" style={{ backgroundColor: "#F2F2F7" }}>
          <div>
            <p className="text-[11px] font-bold uppercase" style={{ color: "#8E8E93" }}>判斷 (Claim)</p>
            <p className="text-[13px] text-foreground leading-snug whitespace-pre-wrap">{claim || "（無）"}</p>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase" style={{ color: "#8E8E93" }}>證據 (Evidence)</p>
            <p className="text-[13px] leading-snug whitespace-pre-wrap" style={{ color: "#3C3C43" }}>{evidence || "（無相關資料）"}</p>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase" style={{ color: "#8E8E93" }}>理由 (Reasoning)</p>
            <p className="text-[13px] leading-snug whitespace-pre-wrap" style={{ color: "#3C3C43" }}>{reasoning || "（無）"}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// Inline API-key entry for a cloud provider (e.g. DeepSeek) that isn't
// configured yet — lets the user type their own key straight into Settings
// instead of editing .env on the backend host by hand. The key is masked
// (type="password") and only ever sent to the backend, which persists it
// server-side (src/utils.py set_api_key) and never echoes it back — this
// component never stores or displays it after a successful save.
function ApiKeyEntry({ providerId, needsKey, onSave }: { providerId: string; needsKey: string; onSave: (provider: string, apiKey: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!value.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(providerId, value.trim());
      setValue("");
      setOpen(false);
    } catch (err) {
      setError("儲存失敗，請檢查金鑰係咪正確同埋後台伺服器有冇連接。");
      console.error("Failed to save API key", err);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div className="px-4 pb-2.5">
        <button onClick={() => setOpen(true)} className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ color: "#007AFF", backgroundColor: "#007AFF18" }}>
          <KeyRound className="w-3 h-3" />設定金鑰
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 pb-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex-1 flex items-center rounded-[10px] px-3 py-2" style={{ backgroundColor: "rgba(118,118,128,0.12)" }}>
          <input
            type={show ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            className="flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-[#8E8E93]"
            placeholder={needsKey}
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSave()}
          />
          <button onClick={() => setShow(s => !s)} className="flex-shrink-0 ml-1" aria-label={show ? "隱藏金鑰" : "顯示金鑰"}>
            {show ? <EyeOff className="w-4 h-4" style={{ color: "#8E8E93" }} /> : <Eye className="w-4 h-4" style={{ color: "#8E8E93" }} />}
          </button>
        </div>
        <button
          onClick={handleSave}
          disabled={!value.trim() || saving}
          className="px-3.5 py-2 rounded-[10px] text-[13px] font-semibold text-white disabled:opacity-40 flex-shrink-0"
          style={{ backgroundColor: "#007AFF" }}
        >
          {saving ? "儲存緊…" : "儲存"}
        </button>
        <button onClick={() => { setOpen(false); setValue(""); setError(null); }} className="flex-shrink-0" aria-label="取消">
          <X className="w-4 h-4" style={{ color: "#8E8E93" }} />
        </button>
      </div>
      {error && <p className="text-[12px]" style={{ color: "#FF3B30" }}>{error}</p>}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [messages, setMessages] = useState<Message[]>([{
    id: "1", role: "agent",
    text: "早晨！我係您的健康助理，專門幫您管理高血壓同糖尿病。今日感覺點呀？",
    time: "上午 9:00",
  }]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [sos, setSos] = useState(false);
  const [taken, setTaken] = useState<Record<string, boolean>>(Object.fromEntries(medications.map(m => [m.name, m.initially])));
  const [listening, setListening] = useState(false);
  const [booked, setBooked] = useState<string | null>(null);
  const [bpData, setBpData] = useState<BPEntry[]>(defaultBP);
  const [glucoseData, setGlucoseData] = useState<GlucoseEntry[]>(defaultGlucose);
  const [hbData, setHbData] = useState<HbA1cEntry[]>(defaultHbA1c);
  // Modal state doubles as "add" vs "amend": "new" opens a blank form, an
  // entry object opens it pre-filled for editing, null keeps it closed.
  const [bpModal, setBpModal] = useState<BPEntry | "new" | null>(null);
  const [glucoseModal, setGlucoseModal] = useState<GlucoseEntry | "new" | null>(null);
  const [hbModal, setHbModal] = useState<HbA1cEntry | "new" | null>(null);
  const [evalReport, setEvalReport] = useState<EvalReport | null>(null);
  const [evalLoading, setEvalLoading] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [ocrReport, setOcrReport] = useState<OcrEvalReport | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [hallucinationReport, setHallucinationReport] = useState<HallucinationReport | null>(null);
  const [hallucinationLoading, setHallucinationLoading] = useState(false);
  const [hallucinationError, setHallucinationError] = useState<string | null>(null);
  const [modelsResponse, setModelsResponse] = useState<ModelsResponse | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelSwitching, setModelSwitching] = useState(false);
  const [activeAlarm, setActiveAlarm] = useState<(typeof medications)[number] | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const recRef = useRef<SpeechRecognition | null>(null);
  // Which medication+day alarms already fired, so the interval below (runs
  // every 30s) doesn't re-trigger the same reminder twice within its minute.
  const firedAlarmsRef = useRef<Set<string>>(new Set());

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, typing]);

  // Hydrate real BP/glucose/HbA1c history from the backend once, on load —
  // falls back to the bundled demo series if the backend has no records yet
  // or is unreachable.
  useEffect(() => {
    getBPRecords().then(records => { if (records.length > 0) setBpData(records); }).catch(() => {});
    getGlucoseRecords().then(records => { if (records.length > 0) setGlucoseData(records); }).catch(() => {});
    getHbA1cRecords().then(records => { if (records.length > 0) setHbData(records); }).catch(() => {});
  }, []);

  // Medication reminder alarm. Foreground-only by nature (checks the device
  // clock while the app/tab is open) — a closed app can't fire this. A true
  // background alarm needs a Service Worker + Push API + server-side
  // scheduler, which is a bigger follow-up (see README, Known extension
  // points). This covers the common case: app open or backgrounded on an
  // iPhone/iPad the elderly user or carer keeps nearby.
  useEffect(() => {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") Notification.requestPermission().catch(() => {});
  }, []);

  useEffect(() => {
    function check() {
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const today = now.toISOString().slice(0, 10);
      for (const med of medications) {
        if (med.time24 !== hhmm || taken[med.name]) continue;
        const key = `${med.name}-${today}-${hhmm}`;
        if (firedAlarmsRef.current.has(key)) continue;
        firedAlarmsRef.current.add(key);
        setActiveAlarm(med);
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification("食藥時間到！", { body: `${med.name}（${med.english}）— ${med.time}`, tag: key });
        }
      }
    }
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, [taken]);

  function markAlarmTaken() {
    if (!activeAlarm) return;
    const name = activeAlarm.name;
    setTaken(p => ({ ...p, [name]: true }));
    logMedication(name, true).catch(err => console.error("Failed to sync medication log", err));
    setActiveAlarm(null);
  }

  function snoozeAlarm() {
    const med = activeAlarm;
    setActiveAlarm(null);
    if (!med) return;
    setTimeout(() => {
      setTaken(prev => {
        if (!prev[med.name]) setActiveAlarm(med);
        return prev;
      });
    }, 10 * 60 * 1000);
  }

  // Save a new record (POST) or amend an existing one (PATCH, when it has an
  // id). Reflects the change locally even if the backend call fails, so the
  // UI never feels broken — logMedication/submitWellness follow the same
  // fire-and-forget-but-still-update-locally pattern elsewhere in this file.
  async function upsertRecord<T extends { id?: string; date: string }>(
    entry: T,
    setData: React.Dispatch<React.SetStateAction<T[]>>,
    create: (e: T) => Promise<T>,
    amend: (id: string, patch: Partial<T>) => Promise<T>,
  ) {
    try {
      const saved = entry.id ? await amend(entry.id, entry) : await create(entry);
      setData(prev => {
        const idx = entry.id ? prev.findIndex(r => r.id === entry.id) : -1;
        if (idx >= 0) { const next = [...prev]; next[idx] = saved; return next; }
        return [...prev, saved];
      });
    } catch (err) {
      console.error("Failed to sync record", err);
      setData(prev => {
        const idx = entry.id ? prev.findIndex(r => r.id === entry.id) : -1;
        if (idx >= 0) { const next = [...prev]; next[idx] = entry; return next; }
        return [...prev, entry];
      });
    }
  }

  async function loadEvalReport() {
    setEvalLoading(true);
    setEvalError(null);
    try {
      const report = await getEvalReport();
      setEvalReport(report);
    } catch (err) {
      setEvalError(
        "未有評估報告，或者後台伺服器未開啟。請喺後台專案根目錄執行 `python -m eval.evaluate`，然後再撳「重新整理」。"
      );
      console.error("Failed to load eval report", err);
    } finally {
      setEvalLoading(false);
    }
  }

  async function loadOcrReport() {
    setOcrLoading(true);
    setOcrError(null);
    try {
      setOcrReport(await getOcrEvalReport());
    } catch (err) {
      setOcrError("未有OCR CER報告。請喺後台專案根目錄執行 `python -m eval.ocr_cer`，然後再撳「重新整理」。");
      console.error("Failed to load OCR eval report", err);
    } finally {
      setOcrLoading(false);
    }
  }

  async function loadHallucinationReport() {
    setHallucinationLoading(true);
    setHallucinationError(null);
    try {
      setHallucinationReport(await getHallucinationReport());
    } catch (err) {
      setHallucinationError(
        "未有100條問題嘅幻覺風險報告。請喺後台專案根目錄執行 `python -m eval.hallucination_csv_eval`，然後再撳「重新整理」。"
      );
      console.error("Failed to load hallucination CSV report", err);
    } finally {
      setHallucinationLoading(false);
    }
  }

  async function loadModels() {
    setModelsLoading(true);
    setModelsError(null);
    try {
      setModelsResponse(await getModels());
    } catch (err) {
      setModelsError("未能連接後台伺服器，未能載入AI模型清單。");
      console.error("Failed to load models", err);
    } finally {
      setModelsLoading(false);
    }
  }

  async function handleSelectModel(provider: string, model: string) {
    setModelSwitching(true);
    try {
      const current = await selectModel(provider, model);
      setModelsResponse(prev => (prev ? { ...prev, current } : prev));
    } catch (err) {
      console.error("Failed to switch model", err);
      window.alert("切換模型失敗，請檢查後台伺服器同埋對應嘅API金鑰有冇設定好。");
    } finally {
      setModelSwitching(false);
    }
  }

  async function handleSaveApiKey(provider: string, apiKey: string) {
    const updated = await setProviderApiKey(provider, apiKey);
    setModelsResponse(updated);
  }

  useEffect(() => {
    if (tab === "eval" && !evalReport && !evalLoading) {
      loadEvalReport();
    }
    if (tab === "eval" && !ocrReport && !ocrLoading) {
      loadOcrReport();
    }
    if (tab === "eval" && !hallucinationReport && !hallucinationLoading) {
      loadHallucinationReport();
    }
    if (tab === "settings" && !modelsResponse && !modelsLoading) {
      loadModels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR(); r.lang = "zh-HK"; r.continuous = false; r.interimResults = false;
    r.onresult = (e: SpeechRecognitionEvent) => { setInput(p => p + e.results[0][0].transcript); setListening(false); };
    r.onerror = () => setListening(false);
    r.onend = () => setListening(false);
    recRef.current = r;
  }, []);

  function toggleMic() {
    if (!recRef.current) return;
    if (listening) { recRef.current.stop(); setListening(false); }
    else { recRef.current.start(); setListening(true); }
  }

  async function send(text?: string) {
    const content = text ?? input;
    if (!content.trim()) return;
    const now = new Date().toLocaleTimeString("zh-HK", { hour: "2-digit", minute: "2-digit" });
    const history: ChatTurn[] = messages.map(m => ({ role: m.role, text: m.text }));
    setMessages(p => [...p, { id: Date.now().toString(), role: "user", text: content, time: now }]);
    setInput("");
    setTyping(true);
    try {
      const { reply, is_emergency } = await sendChatMessage(content, history);
      setMessages(p => [...p, { id: (Date.now() + 1).toString(), role: "agent", text: reply, time: now, isEmergency: is_emergency }]);
      // Don't wait for the user to notice/tap the inline button — surface the
      // 999/emergency-contacts modal immediately, the moment the reply comes back.
      if (is_emergency) setSos(true);
    } catch (err) {
      // Backend/Ollama unreachable — fall back to the local offline demo responses
      // so the app (and especially the emergency-symptom flow) never goes silent.
      console.error("Chat API unavailable, using offline demo response", err);
      const fallback = getAgentResponse(content);
      const emergency = isEmergencyReply(fallback);
      setMessages(p => [...p, { id: (Date.now() + 1).toString(), role: "agent", text: fallback, time: now, isEmergency: emergency }]);
      if (emergency) setSos(true);
    } finally {
      setTyping(false);
    }
  }

  // 長者用家模式 (patient mode) — the chat screen redesign below (≥24px text,
  // WCAG AA/AAA contrast, ≥48px touch targets) only applies here; carer mode
  // keeps the original compact/dense design since it's not the audience with
  // the accessibility need.
  const elderChat = mode === "user";
  const takenCount = Object.values(taken).filter(Boolean).length;
  const latestBP = bpData[bpData.length - 1];
  const latestGlucose = glucoseData[glucoseData.length - 1];
  const latestHb = hbData[hbData.length - 1];
  const bpStatus = latestBP.sys < 130 && latestBP.dia < 80 ? { label: "正常", color: "#34C759" } : latestBP.sys >= 140 ? { label: "偏高", color: "#FF3B30" } : { label: "輕微偏高", color: "#FF9500" };
  const glucoseStatus = latestGlucose.value >= 4.0 && latestGlucose.value <= 7.0 ? { label: "正常", color: "#34C759" } : latestGlucose.value < 4.0 ? { label: "偏低", color: "#FF3B30" } : { label: "偏高", color: "#FF9500" };
  const hbStatus = latestHb.value < 7 ? { label: "達標", color: "#34C759" } : latestHb.value < 8 ? { label: "輕微偏高", color: "#FF9500" } : { label: "偏高", color: "#FF3B30" };

  const displayName = profile?.name ?? "用戶";
  const isMobile = useIsRealMobileDevice();

  return (
    <div className={isMobile ? "size-full" : "size-full flex items-center justify-center bg-[#1C1C1E]"}>
      <div className="relative flex flex-col overflow-hidden bg-background"
        style={isMobile
          ? { width: "100%", height: "100%" }
          : { width: "min(390px, 100%)", height: "min(844px, 100%)", borderRadius: "min(55px, 8vw)", boxShadow: "0 0 0 10px #1C1C1E, 0 40px 80px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(255,255,255,0.12)" }
        }>

        {!isMobile && (
          <>
            {/* Dynamic island */}
            <div className="absolute top-3 left-1/2 -translate-x-1/2 w-[120px] h-[35px] bg-black rounded-full z-50" />
            <StatusBar />
          </>
        )}

        {/* ── Mode Selection ── */}
        {!mode && <ModeLanding onSelect={m => { setMode(m); setTab("home"); }} />}

        {/* ── Onboarding ── */}
        {mode && !profile && <OnboardingPage onDone={p => {
          setProfile(p);
          setMessages([{ id: "1", role: "agent", text: `${p.name}，早晨！我係您的健康助理，專門幫您管理高血壓同糖尿病。今日感覺點呀？`, time: "上午 9:00" }]);
        }} />}

        {/* ── Main app ── */}
        {mode && profile && (
          <>
            {/* Persistent emergency button — reachable from any tab, in both modes.
                Sits above tab content but below full-screen modals. */}
            {!sos && !activeAlarm && (
              <button
                onClick={() => setSos(true)}
                className="absolute z-30 flex items-center justify-center rounded-full shadow-lg active:scale-95 transition-transform"
                style={{
                  right: 16, bottom: 84, width: 56, height: 56,
                  background: "linear-gradient(135deg, #FF3B30, #FF2D55)",
                  boxShadow: "0 6px 20px rgba(255,59,48,0.45)",
                }}
                aria-label="緊急求助"
              >
                <Phone className="w-6 h-6 text-white" />
              </button>
            )}

            {/* Medication alarm */}
            {activeAlarm && (
              <div className="absolute inset-0 z-40 flex flex-col justify-end bg-black/60 backdrop-blur-sm">
                <div className="bg-card rounded-t-[20px] p-6 pb-8">
                  <div className="w-12 h-1 bg-gray-300 rounded-full mx-auto mb-6" />
                  <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: activeAlarm.color + "18" }}>
                    <AlarmClock className="w-8 h-8" style={{ color: activeAlarm.color }} />
                  </div>
                  <h2 className="text-[22px] font-bold text-center text-foreground mb-1">食藥時間到！</h2>
                  <p className="text-center text-[15px] mb-6" style={{ color: "#8E8E93" }}>{activeAlarm.time}</p>
                  <div className="flex items-center gap-3 p-4 rounded-[12px] mb-6" style={{ backgroundColor: "#F2F2F7" }}>
                    <div className="w-10 h-10 rounded-[8px] flex items-center justify-center flex-shrink-0" style={{ backgroundColor: activeAlarm.color }}>
                      <Pill className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <p className="text-[17px] font-semibold text-foreground">{activeAlarm.name}</p>
                      <p className="text-[13px]" style={{ color: "#8E8E93" }}>{activeAlarm.english} · {activeAlarm.note}</p>
                    </div>
                  </div>
                  <button onClick={markAlarmTaken} className="w-full py-4 text-white text-center text-[17px] font-semibold rounded-[14px] mb-3"
                    style={{ backgroundColor: "#34C759" }}>
                    ✅ 已服用
                  </button>
                  <button onClick={snoozeAlarm} className="w-full py-4 text-center text-[17px] font-semibold rounded-[14px] text-[#007AFF]" style={{ backgroundColor: "#F2F2F7" }}>
                    ⏰ 10分鐘後提醒
                  </button>
                </div>
              </div>
            )}

            {/* SOS */}
            {sos && (
              <div className="absolute inset-0 z-40 flex flex-col justify-end bg-black/60 backdrop-blur-sm">
                <div className="bg-card rounded-t-[20px] p-6 pb-8">
                  <div className="w-12 h-1 bg-gray-300 rounded-full mx-auto mb-6" />
                  <div className="w-16 h-16 bg-[#FF3B30]/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Phone className="w-8 h-8 text-[#FF3B30]" />
                  </div>
                  <h2 className="text-[22px] font-bold text-center text-foreground mb-1">緊急求助</h2>
                  <p className="text-center text-[15px] mb-6" style={{ color: "#8E8E93" }}>正在聯絡您的緊急聯絡人</p>
                  <div className="space-y-2 mb-6">
                    {[{ name: "陳大明", role: "兒子", phone: "9123-4567" }, { name: "李家輝醫生", role: "主治醫生", phone: "2345-6789" }].map(c => (
                      <div key={c.name} className="flex items-center gap-3 p-3 rounded-[12px]" style={{ backgroundColor: "#F2F2F7" }}>
                        <div className="w-10 h-10 rounded-full bg-[#007AFF]/20 flex items-center justify-center">
                          <User className="w-5 h-5 text-[#007AFF]" />
                        </div>
                        <div>
                          <p className="text-[15px] font-semibold text-foreground">{c.name}</p>
                          <p className="text-[13px]" style={{ color: "#8E8E93" }}>{c.role} · {c.phone}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <a href="tel:999" className="block w-full py-4 bg-[#FF3B30] text-white text-center text-[17px] font-semibold rounded-[14px] mb-3">致電 999</a>
                  <button onClick={() => setSos(false)} className="w-full py-4 text-center text-[17px] font-semibold rounded-[14px] text-[#007AFF]" style={{ backgroundColor: "#F2F2F7" }}>取消</button>
                </div>
              </div>
            )}

            {/* Consult booked */}
            {booked && (
              <div className="absolute inset-0 z-40 flex flex-col justify-end bg-black/60 backdrop-blur-sm">
                <div className="bg-card rounded-t-[20px] p-6 pb-8 text-center">
                  <div className="w-12 h-1 bg-gray-300 rounded-full mx-auto mb-6" />
                  <div className="w-16 h-16 bg-[#007AFF]/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Video className="w-8 h-8 text-[#007AFF]" />
                  </div>
                  <h2 className="text-[22px] font-bold text-foreground mb-2">正在連線…</h2>
                  <p className="text-[15px] mb-1" style={{ color: "#8E8E93" }}>您將與</p>
                  <p className="text-[17px] font-semibold text-foreground mb-1">{booked}</p>
                  <p className="text-[15px] mb-8" style={{ color: "#8E8E93" }}>進行視訊問診。請確保身處光線充足的地方。</p>
                  <button onClick={() => setBooked(null)} className="w-full py-4 text-[17px] font-semibold rounded-[14px] text-[#007AFF]" style={{ backgroundColor: "#F2F2F7" }}>取消</button>
                </div>
              </div>
            )}

            {/* Add/amend BP, glucose, HbA1c modals */}
            {bpModal && (
              <BPModal
                initial={bpModal === "new" ? undefined : bpModal}
                onSave={e => upsertRecord(e, setBpData, logBPRecord, amendBPRecord)}
                onClose={() => setBpModal(null)}
              />
            )}
            {glucoseModal && (
              <GlucoseModal
                initial={glucoseModal === "new" ? undefined : glucoseModal}
                onSave={e => upsertRecord(e, setGlucoseData, logGlucoseRecord, amendGlucoseRecord)}
                onClose={() => setGlucoseModal(null)}
              />
            )}
            {hbModal && (
              <HbA1cModal
                initial={hbModal === "new" ? undefined : hbModal}
                onSave={e => upsertRecord(e, setHbData, logHbA1cRecord, amendHbA1cRecord)}
                onClose={() => setHbModal(null)}
              />
            )}

            <div className="flex-1 overflow-hidden flex flex-col">

              {/* ── 主頁 ── */}
              {tab === "home" && (
                <>
                  <NavBar title="主頁" large />
                  <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
                    <div className="pt-2 pb-6 space-y-6">
                      {/* User profile card */}
                      <div className="mx-4 rounded-[16px] bg-[#007AFF] p-5 flex items-center gap-4">
                        <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                          <span className="text-white text-[22px] font-bold">{displayName.charAt(0)}</span>
                        </div>
                        <div>
                          <p className="text-white/70 text-[13px]">早晨</p>
                          <p className="text-white text-[22px] font-bold leading-tight">{displayName}</p>
                          <p className="text-white/70 text-[13px]">{profile.age} 歲 · {profile.gender}性</p>
                        </div>
                        <div className="ml-auto w-12 h-12 bg-white/15 rounded-full flex items-center justify-center">
                          <Activity className="w-6 h-6 text-white" />
                        </div>
                      </div>

                      {/* Vitals summary (carer only) */}
                      {mode === "carer" && (
                        <div className="mx-4 grid grid-cols-2 gap-3">
                          <button onClick={() => setTab("records")} className="bg-card rounded-[16px] p-4 text-left" style={{ boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" }}>
                            <p className="text-[12px] font-semibold mb-2" style={{ color: "#8E8E93" }}>最新血壓</p>
                            <p className="text-[22px] font-bold text-foreground leading-tight">{latestBP.sys}/{latestBP.dia}</p>
                            <p className="text-[11px] mb-2" style={{ color: "#8E8E93" }}>mmHg</p>
                            <span className="text-[12px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: bpStatus.color + "18", color: bpStatus.color }}>{bpStatus.label}</span>
                          </button>
                          <button onClick={() => setTab("records")} className="bg-card rounded-[16px] p-4 text-left" style={{ boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" }}>
                            <p className="text-[12px] font-semibold mb-2" style={{ color: "#8E8E93" }}>最新 HbA1c</p>
                            <p className="text-[22px] font-bold text-foreground leading-tight">{latestHb.value}<span className="text-[14px]">%</span></p>
                            <p className="text-[11px] mb-2" style={{ color: "#8E8E93" }}>糖化血紅蛋白</p>
                            <span className="text-[12px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: hbStatus.color + "18", color: hbStatus.color }}>{hbStatus.label}</span>
                          </button>
                        </div>
                      )}

                      {/* Medications summary (carer only) */}
                      {mode === "carer" && (
                        <Section label="今日藥物">
                          <Cell icon={<Pill className="w-5 h-5 text-white" />} iconBg="#007AFF"
                            label={`${takenCount} / ${medications.length} 已服用`} sublabel="點擊查看詳情"
                            onPress={() => setTab("medications")} last />
                        </Section>
                      )}

                      {/* Quick chat */}
                      <Section label="快速提問">
                        {quickPrompts.map((q, i) => (
                          <Cell key={q} icon={<MessageCircle className="w-4 h-4 text-white" />} iconBg="#007AFF"
                            label={q} onPress={() => { setTab("chat"); setTimeout(() => send(q), 200); }}
                            last={i === quickPrompts.length - 1} />
                        ))}
                      </Section>

                      {/* Reminders (carer only — the 主頁 quick-glance list; the elderly
                          user still gets alarms via the medication reminder modal) */}
                      {mode === "carer" && (
                        <Section label="待服藥物">
                          {medications.filter(m => !taken[m.name]).length === 0
                            ? <div className="px-4 py-5 text-center text-[15px] text-[#8E8E93]">今日所有藥物已服用 ✓</div>
                            : medications.filter(m => !taken[m.name]).map((med, i, arr) => (
                              <Cell key={med.name} icon={<Pill className="w-4 h-4 text-white" />} iconBg={med.color}
                                label={med.name} sublabel={med.english}
                                right={<span className="text-[13px] text-[#8E8E93]">{med.time}</span>}
                                last={i === arr.length - 1} />
                            ))
                          }
                        </Section>
                      )}

                      <Section>
                        <Cell icon={<Phone className="w-5 h-5 text-white" />} iconBg="#FF3B30"
                          label="緊急求助" sublabel="聯絡家人及醫生"
                          onPress={() => {
                            setSos(true);
                            alertCaregiver("使用者已按下緊急求助按鈕").catch(err => console.error("Failed to notify caregiver", err));
                          }}
                          last danger />
                      </Section>
                    </div>
                  </div>
                </>
              )}

              {/* ── 對話 ──
                  長者用家模式 (elderChat) redesign: ≥24px text throughout,
                  WCAG AA/AAA-contrast colours (see ELDER_BLUE/ELDER_RED/
                  ELDER_MUTED above), ≥48px touch targets, and visible focus
                  rings. Carer mode is untouched (elderChat is false there). */}
              {tab === "chat" && (
                <>
                  <NavBar title="健康助理" elder={elderChat} />
                  <div className={`flex-1 overflow-y-auto ${elderChat ? "px-4 py-5 space-y-5" : "px-3 py-4 space-y-3"}`} style={{ scrollbarWidth: "none" }}>
                    {messages.map(m => (
                      <div key={m.id} className="flex flex-col gap-2">
                        <div className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} items-end gap-2`}>
                          {m.role === "agent" && (
                            <div className={`rounded-full flex items-center justify-center flex-shrink-0 mb-1 ${elderChat ? "w-12 h-12" : "w-8 h-8"}`}
                              style={{ backgroundColor: elderChat ? ELDER_BLUE : "#007AFF" }}>
                              <Activity className={elderChat ? "w-7 h-7 text-white" : "w-4 h-4 text-white"} />
                            </div>
                          )}
                          <div
                            className={`rounded-[18px] leading-relaxed ${elderChat ? "max-w-[88%] px-5 py-4 text-[24px] leading-[1.5]" : "max-w-[78%] px-4 py-2.5 text-[16px]"} ${m.role === "user" ? "text-white rounded-br-[4px]" : "bg-card text-foreground rounded-bl-[4px]"}`}
                            style={{
                              backgroundColor: m.role === "user" ? (elderChat ? ELDER_BLUE : "#007AFF") : undefined,
                              boxShadow: m.role === "agent" ? "0 0 0 0.5px rgba(60,60,67,0.18)" : undefined,
                            }}>
                            {m.text}
                          </div>
                        </div>
                        {m.role === "agent" && m.isEmergency && (
                          <div className={`flex flex-wrap items-center gap-3 ${elderChat ? "pl-14" : "pl-10"}`}>
                            <a href="tel:999"
                              className={`flex items-center gap-2 rounded-full font-bold text-white ${elderChat ? `px-6 py-4 text-[22px] ${ELDER_FOCUS_RING}` : "px-3.5 py-2 text-[13px] font-semibold"}`}
                              style={{ backgroundColor: elderChat ? ELDER_RED : "#FF3B30" }}>
                              <Phone className={elderChat ? "w-6 h-6" : "w-3.5 h-3.5"} />致電999
                            </a>
                            <button
                              onClick={() => {
                                setSos(true);
                                alertCaregiver("對話中偵測到緊急徵狀，使用者可能需要協助").catch(err => console.error("Failed to notify caregiver", err));
                              }}
                              className={`flex items-center gap-2 rounded-full font-bold ${elderChat ? `px-6 py-4 text-[22px] ${ELDER_FOCUS_RING}` : "px-3.5 py-2 text-[13px] font-semibold"}`}
                              style={elderChat ? { backgroundColor: "#B0002018", color: ELDER_RED } : { backgroundColor: "#FF3B301A", color: "#FF3B30" }}>
                              尋求緊急協助
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                    {typing && (
                      <div className="flex items-end gap-2">
                        <div className={`rounded-full flex items-center justify-center ${elderChat ? "w-12 h-12" : "w-8 h-8"}`} style={{ backgroundColor: elderChat ? ELDER_BLUE : "#007AFF" }}>
                          <Activity className={elderChat ? "w-7 h-7 text-white" : "w-4 h-4 text-white"} />
                        </div>
                        <div className={`bg-card rounded-[18px] rounded-bl-[4px] ${elderChat ? "px-5 py-4" : "px-4 py-3"}`} style={{ boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" }}>
                          <div className={`flex gap-1.5 items-center ${elderChat ? "h-6" : "h-5"}`}>
                            {[0, 1, 2].map(i => (
                              <span key={i} className={`rounded-full animate-bounce ${elderChat ? "w-3 h-3" : "w-2 h-2"}`}
                                style={{ backgroundColor: elderChat ? ELDER_MUTED : "#8E8E93", animationDelay: `${i * 0.15}s` }} />
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={chatEnd} />
                  </div>

                  <div className="flex-shrink-0 flex flex-col items-center bg-card/80 backdrop-blur-xl border-t pb-3"
                    style={{ borderColor: "rgba(60,60,67,0.18)", WebkitBackdropFilter: "blur(20px)" }}>
                    <div className={`w-full flex overflow-x-auto ${elderChat ? "px-4 pt-4 pb-3 gap-3" : "px-3 pt-3 pb-2 gap-2"}`} style={{ scrollbarWidth: "none" }}>
                      {["血壓偏高", "血糖過低", "腳部麻痺", "忘記食藥"].map(q => (
                        <button key={q} onClick={() => send(q)}
                          className={`flex-shrink-0 rounded-full border font-bold ${elderChat ? `px-6 py-3.5 text-[22px] ${ELDER_FOCUS_RING}` : "px-4 py-1.5 text-[13px] font-medium"}`}
                          style={elderChat ? { borderColor: ELDER_BLUE, borderWidth: 2, backgroundColor: "#0051D40F", color: ELDER_BLUE } : { borderColor: "#007AFF", backgroundColor: "rgba(0,122,255,0.06)", color: "#007AFF" }}>
                          {q}
                        </button>
                      ))}
                    </div>
                    <div className={`flex flex-col items-center gap-2 ${elderChat ? "py-5" : "py-4"}`}>
                      <div className="relative flex items-center justify-center">
                        {listening && (
                          <>
                            <span className="absolute w-28 h-28 rounded-full bg-[#007AFF]/10 animate-ping" style={{ animationDuration: "1.2s" }} />
                            <span className="absolute w-36 h-36 rounded-full bg-[#007AFF]/05 animate-ping" style={{ animationDuration: "1.6s", animationDelay: "0.2s" }} />
                          </>
                        )}
                        <button onClick={toggleMic}
                          aria-label={listening ? "停止語音輸入" : "開始語音輸入"}
                          className={`relative rounded-full flex items-center justify-center transition-all duration-200 active:scale-95 ${elderChat ? `w-24 h-24 ${ELDER_FOCUS_RING}` : "w-20 h-20"}`}
                          style={{
                            background: listening
                              ? (elderChat ? `linear-gradient(145deg,${ELDER_RED},#8A0018)` : "linear-gradient(145deg,#FF3B30,#FF2D55)")
                              : (elderChat ? `linear-gradient(145deg,${ELDER_BLUE},#003D99)` : "linear-gradient(145deg,#007AFF,#5AC8FA)"),
                            boxShadow: listening ? "0 8px 32px rgba(255,59,48,0.45)" : "0 8px 32px rgba(0,122,255,0.40)",
                          }}>
                          {listening
                            ? <MicOff className={elderChat ? "w-12 h-12 text-white" : "w-9 h-9 text-white"} />
                            : <Mic className={elderChat ? "w-12 h-12 text-white" : "w-9 h-9 text-white"} />}
                        </button>
                      </div>
                      <p className={`font-bold ${elderChat ? "text-[24px]" : "text-[13px] font-medium"}`} style={{ color: listening ? (elderChat ? ELDER_RED : "#FF3B30") : (elderChat ? ELDER_MUTED : "#8E8E93") }}>
                        {listening ? "聆聽中，輕按停止" : "輕按說話"}
                      </p>
                    </div>
                    <div className={`w-full flex items-center gap-2 ${elderChat ? "px-4" : "px-3"}`}>
                      <div className={`flex-1 flex items-center rounded-full ${elderChat ? "px-5 py-4" : "px-4 py-2.5"}`} style={{ backgroundColor: "rgba(118,118,128,0.12)" }}>
                        <input
                          className={`flex-1 bg-transparent text-foreground outline-none ${elderChat ? `text-[24px] placeholder:text-[#48484A] ${ELDER_FOCUS_RING}` : "text-[16px] placeholder:text-[#8E8E93]"}`}
                          placeholder={listening ? "聆聽中…" : "或者輸入文字…"} value={input}
                          onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} />
                      </div>
                      <button onClick={() => send()} disabled={!input.trim()} aria-label="傳送"
                        className={`rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-40 transition-opacity ${elderChat ? `w-16 h-16 ${ELDER_FOCUS_RING}` : "w-10 h-10"}`}
                        style={{ backgroundColor: elderChat ? ELDER_BLUE : "#007AFF" }}>
                        <Send className={elderChat ? "w-7 h-7 text-white" : "w-4 h-4 text-white"} />
                      </button>
                    </div>
                  </div>
                </>
              )}

              {/* ── 藥物 ── */}
              {tab === "medications" && mode === "carer" && (
                <>
                  <NavBar title="藥物時間表" large />
                  <div className="flex-1 overflow-y-auto py-3 space-y-6" style={{ scrollbarWidth: "none" }}>
                    <div className="mx-4 bg-card rounded-[16px] p-4" style={{ boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" }}>
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[15px] font-semibold text-foreground">今日進度</p>
                        <p className="text-[15px] font-semibold text-[#007AFF]">{takenCount} / {medications.length}</p>
                      </div>
                      <div className="h-2 bg-[#F2F2F7] rounded-full overflow-hidden">
                        <div className="h-full bg-[#007AFF] rounded-full transition-all duration-500" style={{ width: `${(takenCount / medications.length) * 100}%` }} />
                      </div>
                    </div>
                    {["血壓藥", "糖尿藥"].map(note => (
                      <Section key={note} label={note}>
                        {medications.filter(m => m.note === note).map((med, i, arr) => (
                          <div key={med.name} className={`px-4 py-3 flex items-center gap-3 ${i < arr.length - 1 ? "border-b" : ""}`} style={{ borderColor: "rgba(60,60,67,0.12)" }}>
                            <div className="w-9 h-9 rounded-[8px] flex items-center justify-center flex-shrink-0" style={{ backgroundColor: med.color }}>
                              <Pill className="w-5 h-5 text-white" />
                            </div>
                            <div className="flex-1">
                              <p className="text-[17px] text-foreground">{med.name}</p>
                              <p className="text-[13px] text-[#8E8E93]">{med.english} · {med.time}</p>
                            </div>
                            <button onClick={() => {
                              const next = !taken[med.name];
                              setTaken(p => ({ ...p, [med.name]: next }));
                              logMedication(med.name, next).catch(err => console.error("Failed to sync medication log", err));
                            }}
                              className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all"
                              style={{ backgroundColor: taken[med.name] ? "#34C759" : "rgba(118,118,128,0.18)" }}>
                              {taken[med.name] && <Check className="w-4 h-4 text-white" strokeWidth={3} />}
                            </button>
                          </div>
                        ))}
                      </Section>
                    ))}
                  </div>
                </>
              )}

              {/* ── 記錄 ── */}
              {tab === "records" && mode === "carer" && (
                <>
                  <NavBar title="健康記錄" large />
                  <div className="flex-1 overflow-y-auto py-3 pb-6 space-y-6" style={{ scrollbarWidth: "none" }}>

                    {/* Blood Pressure chart card */}
                    <div className="mx-4 bg-card rounded-[16px] overflow-hidden" style={{ boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" }}>
                      <div className="flex items-center justify-between px-4 pt-4 pb-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <TrendingUp className="w-4 h-4 text-[#007AFF]" />
                            <p className="text-[15px] font-semibold text-foreground">血壓趨勢</p>
                          </div>
                          <p className="text-[12px] mt-0.5" style={{ color: "#8E8E93" }}>目標：&lt;130/80 mmHg</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-right mr-1">
                            <p className="text-[18px] font-bold text-foreground">{latestBP.sys}/{latestBP.dia}</p>
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: bpStatus.color + "18", color: bpStatus.color }}>{bpStatus.label}</span>
                          </div>
                          <button onClick={() => setBpModal("new")}
                            className="w-8 h-8 rounded-full bg-[#007AFF] flex items-center justify-center flex-shrink-0">
                            <Plus className="w-4 h-4 text-white" />
                          </button>
                        </div>
                      </div>
                      <div className="px-2 pb-4" style={{ height: 180 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={bpData} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(60,60,67,0.08)" />
                            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#8E8E93" }} axisLine={false} tickLine={false} />
                            <YAxis domain={[60, 170]} tick={{ fontSize: 11, fill: "#8E8E93" }} axisLine={false} tickLine={false} />
                            <Tooltip content={(p: any) => <BPTooltip {...p} />} />
                            <ReferenceLine y={130} stroke="#FF3B30" strokeDasharray="4 3" strokeWidth={1} label={{ value: "130", fill: "#FF3B30", fontSize: 10, position: "right" }} />
                            <ReferenceLine y={80} stroke="#FF9500" strokeDasharray="4 3" strokeWidth={1} label={{ value: "80", fill: "#FF9500", fontSize: 10, position: "right" }} />
                            <Line type="monotone" dataKey="sys" stroke="#007AFF" strokeWidth={2.5} dot={{ r: 4, fill: "#007AFF", strokeWidth: 0 }} name="收縮壓" activeDot={{ r: 6 }} />
                            <Line type="monotone" dataKey="dia" stroke="#5AC8FA" strokeWidth={2.5} dot={{ r: 4, fill: "#5AC8FA", strokeWidth: 0 }} name="舒張壓" activeDot={{ r: 6 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="flex gap-4 px-4 pb-4">
                        <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-[#007AFF]" /><p className="text-[12px] text-[#8E8E93]">收縮壓</p></div>
                        <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-[#5AC8FA]" /><p className="text-[12px] text-[#8E8E93]">舒張壓</p></div>
                        <div className="flex items-center gap-1.5"><div className="w-5 border-t-2 border-dashed border-[#FF3B30]" /><p className="text-[12px] text-[#8E8E93]">收縮壓目標</p></div>
                      </div>
                    </div>

                    {/* Recent BP readings — tap to amend */}
                    <Section label="血壓記錄（輕按可修改）">
                      {[...bpData].reverse().slice(0, 7).map((r, i, arr) => {
                        const s = r.sys < 130 && r.dia < 80 ? { label: "正常", color: "#34C759" } : r.sys >= 140 ? { label: "偏高", color: "#FF3B30" } : { label: "輕微偏高", color: "#FF9500" };
                        return (
                          <button key={r.id ?? i} onClick={() => setBpModal(r)}
                            className={`w-full px-4 py-3 flex items-center justify-between text-left active:bg-gray-100 transition-colors ${i < arr.length - 1 ? "border-b" : ""}`}
                            style={{ borderColor: "rgba(60,60,67,0.12)" }}>
                            <div>
                              <p className="text-[17px] font-semibold text-foreground">{r.sys}/{r.dia} <span className="text-[13px] font-normal text-[#8E8E93]">mmHg</span></p>
                              <p className="text-[13px] text-[#8E8E93]">{r.date}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[12px] font-bold px-2.5 py-1 rounded-full" style={{ backgroundColor: s.color + "18", color: s.color }}>{s.label}</span>
                              <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: "#C7C7CC" }} />
                            </div>
                          </button>
                        );
                      })}
                    </Section>

                    {/* Glucose (血糖) chart card */}
                    <div className="mx-4 bg-card rounded-[16px] overflow-hidden" style={{ boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" }}>
                      <div className="flex items-center justify-between px-4 pt-4 pb-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <Activity className="w-4 h-4 text-[#5AC8FA]" />
                            <p className="text-[15px] font-semibold text-foreground">血糖趨勢</p>
                          </div>
                          <p className="text-[12px] mt-0.5" style={{ color: "#8E8E93" }}>目標：空腹 4.0 – 7.0 mmol/L</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-right mr-1">
                            <p className="text-[18px] font-bold text-foreground">{latestGlucose.value}</p>
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: glucoseStatus.color + "18", color: glucoseStatus.color }}>{glucoseStatus.label}</span>
                          </div>
                          <button onClick={() => setGlucoseModal("new")}
                            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: "#5AC8FA" }}>
                            <Plus className="w-4 h-4 text-white" />
                          </button>
                        </div>
                      </div>
                      <div className="px-2 pb-4" style={{ height: 160 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={glucoseData} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(60,60,67,0.08)" />
                            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#8E8E93" }} axisLine={false} tickLine={false} />
                            <YAxis domain={[2, 12]} tick={{ fontSize: 11, fill: "#8E8E93" }} axisLine={false} tickLine={false} />
                            <Tooltip content={(p: any) => <GlucoseTooltip {...p} />} />
                            <ReferenceLine y={7} stroke="#34C759" strokeDasharray="4 3" strokeWidth={1} label={{ value: "7.0", fill: "#34C759", fontSize: 10, position: "right" }} />
                            <ReferenceLine y={4} stroke="#FF9500" strokeDasharray="4 3" strokeWidth={1} label={{ value: "4.0", fill: "#FF9500", fontSize: 10, position: "right" }} />
                            <Line type="monotone" dataKey="value" stroke="#5AC8FA" strokeWidth={2.5} dot={{ r: 4, fill: "#5AC8FA", strokeWidth: 0 }} name="血糖" activeDot={{ r: 6 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Recent glucose readings — tap to amend */}
                    <Section label="血糖記錄（輕按可修改）">
                      {[...glucoseData].reverse().slice(0, 7).map((r, i, arr) => {
                        const s = r.value >= 4.0 && r.value <= 7.0 ? { label: "正常", color: "#34C759" } : r.value < 4.0 ? { label: "偏低", color: "#FF3B30" } : { label: "偏高", color: "#FF9500" };
                        return (
                          <button key={r.id ?? i} onClick={() => setGlucoseModal(r)}
                            className={`w-full px-4 py-3 flex items-center justify-between text-left active:bg-gray-100 transition-colors ${i < arr.length - 1 ? "border-b" : ""}`}
                            style={{ borderColor: "rgba(60,60,67,0.12)" }}>
                            <div>
                              <p className="text-[17px] font-semibold text-foreground">{r.value} <span className="text-[13px] font-normal text-[#8E8E93]">mmol/L</span></p>
                              <p className="text-[13px] text-[#8E8E93]">{r.date}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[12px] font-bold px-2.5 py-1 rounded-full" style={{ backgroundColor: s.color + "18", color: s.color }}>{s.label}</span>
                              <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: "#C7C7CC" }} />
                            </div>
                          </button>
                        );
                      })}
                    </Section>

                    {/* HbA1c chart card */}
                    <div className="mx-4 bg-card rounded-[16px] overflow-hidden" style={{ boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" }}>
                      <div className="flex items-center justify-between px-4 pt-4 pb-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <BarChart2 className="w-4 h-4 text-[#FF9500]" />
                            <p className="text-[15px] font-semibold text-foreground">HbA1c 糖化血紅蛋白</p>
                          </div>
                          <p className="text-[12px] mt-0.5" style={{ color: "#8E8E93" }}>目標：低於 7.0%</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-right mr-1">
                            <p className="text-[18px] font-bold text-foreground">{latestHb.value}%</p>
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: hbStatus.color + "18", color: hbStatus.color }}>{hbStatus.label}</span>
                          </div>
                          <button onClick={() => setHbModal("new")}
                            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: "#FF9500" }}>
                            <Plus className="w-4 h-4 text-white" />
                          </button>
                        </div>
                      </div>
                      <div className="px-2 pb-4" style={{ height: 160 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={hbData} margin={{ top: 8, right: 12, left: -20, bottom: 0 }} barSize={28}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(60,60,67,0.08)" vertical={false} />
                            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#8E8E93" }} axisLine={false} tickLine={false} />
                            <YAxis domain={[5, 10]} tick={{ fontSize: 11, fill: "#8E8E93" }} axisLine={false} tickLine={false} />
                            <Tooltip content={(p: any) => <HbA1cTooltip {...p} />} />
                            <ReferenceLine y={7} stroke="#34C759" strokeDasharray="4 3" strokeWidth={1.5} label={{ value: "7.0%", fill: "#34C759", fontSize: 10, position: "right" }} />
                            <Bar dataKey="value" name="HbA1c" radius={[5, 5, 0, 0]}
                              fill="#FF9500"
                              label={{ position: "top", formatter: (v: number) => `${v}%`, fontSize: 11, fill: "#FF9500" }}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Recent HbA1c readings — tap to amend */}
                    <Section label="HbA1c 記錄（輕按可修改）">
                      {[...hbData].reverse().map((r, i, arr) => {
                        const s = r.value < 7 ? { label: "達標", color: "#34C759" } : r.value < 8 ? { label: "輕微偏高", color: "#FF9500" } : { label: "偏高", color: "#FF3B30" };
                        return (
                          <button key={r.id ?? i} onClick={() => setHbModal(r)}
                            className={`w-full px-4 py-3 flex items-center justify-between text-left active:bg-gray-100 transition-colors ${i < arr.length - 1 ? "border-b" : ""}`}
                            style={{ borderColor: "rgba(60,60,67,0.12)" }}>
                            <div>
                              <p className="text-[17px] font-semibold text-foreground">{r.value}% <span className="text-[13px] font-normal text-[#8E8E93]">HbA1c</span></p>
                              <p className="text-[13px] text-[#8E8E93]">{r.date}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[12px] font-bold px-2.5 py-1 rounded-full" style={{ backgroundColor: s.color + "18", color: s.color }}>{s.label}</span>
                              <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: "#C7C7CC" }} />
                            </div>
                          </button>
                        );
                      })}
                    </Section>
                  </div>
                </>
              )}

              {/* ── 醫療諮詢 ── */}
              {tab === "consult" && mode === "carer" && (
                <>
                  <NavBar title="即時醫療諮詢" large />
                  <div className="flex-1 overflow-y-auto py-3 space-y-6" style={{ scrollbarWidth: "none" }}>
                    <div className="mx-4 bg-[#007AFF] rounded-[16px] p-4">
                      <p className="text-white/70 text-[13px] font-medium mb-2">視訊問診流程</p>
                      <div className="flex justify-between">
                        {[{ step: "選擇醫生", icon: User }, { step: "即時視訊", icon: Video }, { step: "領取處方", icon: Pill }].map((s, i) => (
                          <div key={s.step} className="flex flex-col items-center gap-1.5">
                            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                              <s.icon className="w-5 h-5 text-white" />
                            </div>
                            <p className="text-white text-[12px] font-semibold">{i + 1}. {s.step}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <Section label="現時可應診醫生">
                      {doctors.map((doc, i) => (
                        <div key={doc.name} className={`px-4 py-4 ${i < doctors.length - 1 ? "border-b" : ""}`} style={{ borderColor: "rgba(60,60,67,0.12)" }}>
                          <div className="flex items-center gap-3 mb-3">
                            <div className="w-12 h-12 rounded-full flex items-center justify-center text-white text-[20px] font-bold flex-shrink-0" style={{ backgroundColor: doc.bg }}>{doc.initials}</div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-[17px] font-semibold text-foreground">{doc.name}</p>
                                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${doc.available ? "text-[#34C759] bg-[#34C759]/10" : "text-[#8E8E93] bg-[#F2F2F7]"}`}>
                                  {doc.available ? "可應診" : "繁忙"}
                                </span>
                              </div>
                              <p className="text-[13px] text-[#8E8E93]">{doc.specialty}</p>
                              <p className="text-[13px] text-[#8E8E93]">{doc.hospital}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 mb-3">
                            <div className="flex items-center gap-1">
                              <Star className="w-3.5 h-3.5 text-[#FF9500] fill-[#FF9500]" />
                              <span className="text-[13px] font-semibold text-foreground">{doc.rating}</span>
                              <span className="text-[13px] text-[#8E8E93]">({doc.reviews})</span>
                            </div>
                            <div className="flex items-center gap-1 text-[#8E8E93]">
                              <Clock className="w-3.5 h-3.5" />
                              <span className="text-[13px]">{doc.wait}</span>
                            </div>
                          </div>
                          <button onClick={() => doc.available && setBooked(doc.name)} disabled={!doc.available}
                            className="w-full py-3 rounded-[12px] text-[15px] font-semibold flex items-center justify-center gap-2 disabled:opacity-40"
                            style={{ backgroundColor: "#007AFF", color: "#fff" }}>
                            <Video className="w-4 h-4" />
                            {doc.available ? "立即視訊問診" : "暫時不可預約"}
                          </button>
                        </div>
                      ))}
                    </Section>
                  </div>
                </>
              )}

              {/* ── 掃描 (OCR document scan) ── */}
              {tab === "scan" && mode === "carer" && <ScanTab />}

              {/* ── 設定 ── */}
              {tab === "settings" && mode === "carer" && (
                <SettingsTab
                  profile={profile}
                  mode={mode}
                  onSave={setProfile}
                  onOpenTab={setTab}
                  onSwitchMode={() => { setMode("user"); setTab("home"); }}
                  modelsResponse={modelsResponse}
                  modelsLoading={modelsLoading}
                  modelsError={modelsError}
                  modelSwitching={modelSwitching}
                  onSelectModel={handleSelectModel}
                  onRetryModels={loadModels}
                  onSaveApiKey={handleSaveApiKey}
                />
              )}

              {/* ── 測試 (Testing & Hallucination Evaluation) ── */}
              {tab === "eval" && mode === "carer" && (
                <>
                  <NavBar title="測試同評估" large />
                  <div className="flex-1 overflow-y-auto py-3 space-y-6" style={{ scrollbarWidth: "none" }}>
                    <p className="mx-4 text-[13px]" style={{ color: "#8E8E93" }}>
                      下面有三份報告：<code>eval/evaluate.py</code>（20條指引問題，準確度／安全／亂up）、
                      <code>eval/ocr_cer.py</code>（OCR文字辨識準確度）、同埋
                      <code>eval/hallucination_csv_eval.py</code>（100條幻覺風險壓力測試）。
                      每個測試結果都附有「判斷／證據／理由」，可以撳開睇。
                    </p>

                    {/* ══ 1. QA 準確度／安全／幻覺測試 ══ */}
                    {evalLoading && (
                      <div className="mx-4 bg-card rounded-[16px] p-8 text-center" style={{ boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" }}>
                        <RefreshCw className="w-6 h-6 mx-auto mb-3 animate-spin" style={{ color: "#007AFF" }} />
                        <p className="text-[15px]" style={{ color: "#8E8E93" }}>載入緊評估報告…</p>
                      </div>
                    )}

                    {!evalLoading && evalError && (
                      <div className="mx-4 bg-card rounded-[16px] p-6 text-center" style={{ boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" }}>
                        <AlertTriangle className="w-8 h-8 mx-auto mb-3" style={{ color: "#FF9500" }} />
                        <p className="text-[15px] text-foreground mb-4">{evalError}</p>
                        <button
                          onClick={loadEvalReport}
                          className="px-6 py-3 rounded-[14px] text-[#007AFF] text-[15px] font-semibold"
                          style={{ backgroundColor: "#F2F2F7" }}
                        >
                          重新整理
                        </button>
                      </div>
                    )}

                    {!evalLoading && !evalError && evalReport && (
                      <>
                        {/* Overall */}
                        <div
                          className="mx-4 rounded-[16px] p-5 flex items-center justify-between"
                          style={{ backgroundColor: rateColor(evalReport.summary.overall_pass_rate) }}
                        >
                          <div>
                            <p className="text-white/70 text-[13px] font-medium">整體通過率</p>
                            <p className="text-white text-[34px] font-bold leading-none mt-1">
                              {Math.round(evalReport.summary.overall_pass_rate * 100)}%
                            </p>
                            <p className="text-white/70 text-[13px] mt-1">
                              {evalReport.cases.length} 條測試問題 · 每條重複 {evalReport.repeat} 次 · 模型 {evalReport.provider}/{evalReport.model}
                            </p>
                            <p className="text-white/70 text-[13px]">
                              平均回應時間 {(evalReport.summary.mean_latency_ms / 1000).toFixed(1)}s
                            </p>
                          </div>
                          <ShieldCheck className="w-12 h-12 text-white/80" />
                        </div>

                        {evalReport.summary.hallucination_related_pass_rate !== null && (
                          <Section label="關鍵安全指標">
                            <Cell
                              icon={<AlertTriangle className="w-5 h-5 text-white" />}
                              iconBg={rateColor(evalReport.summary.hallucination_related_pass_rate)}
                              label="防止亂up + 工具動作一致性"
                              sublabel="呢個數字最直接反映模型有冇講大話或者亂up資料"
                              right={<RateBadge rate={evalReport.summary.hallucination_related_pass_rate} />}
                              last
                            />
                          </Section>
                        )}

                        {/* Per category */}
                        <Section label="各類別通過率">
                          {Object.entries(evalReport.summary.by_category).map(([cat, rate], i, arr) => (
                            <Cell
                              key={cat}
                              label={evalCategoryLabels[cat] ?? cat}
                              right={<RateBadge rate={rate} />}
                              last={i === arr.length - 1}
                            />
                          ))}
                        </Section>

                        {/* Individual cases */}
                        <Section label="個別測試結果 (20條)">
                          {evalReport.cases.map((c, i, arr) => {
                            const passed = c.pass_rate === 1;
                            const failedRuns = c.runs.filter(r => !r.pass);
                            const firstRun = c.runs[0];
                            return (
                              <div
                                key={c.id}
                                className={`px-4 py-3 ${i < arr.length - 1 ? "border-b" : ""}`}
                                style={{ borderColor: "rgba(60,60,67,0.12)" }}
                              >
                                <div className="flex items-start gap-2">
                                  {passed
                                    ? <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: "#34C759" }} />
                                    : <XCircle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: "#FF3B30" }} />}
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[15px] text-foreground leading-snug">{c.question}</p>
                                    <p className="text-[12px] mt-0.5" style={{ color: "#8E8E93" }}>
                                      {evalCategoryLabels[c.category] ?? c.category}
                                    </p>
                                    {failedRuns.length > 0 && failedRuns[0].reasons.map((reason, ri) => (
                                      <p key={ri} className="text-[12px] mt-1" style={{ color: "#FF3B30" }}>
                                        ⚠ {reason}
                                      </p>
                                    ))}
                                    {firstRun && (
                                      <ClaimEvidenceReasoning
                                        claim={firstRun.claim}
                                        evidence={firstRun.evidence}
                                        reasoning={firstRun.reasoning}
                                        latencyMs={c.mean_latency_ms}
                                      />
                                    )}
                                  </div>
                                  <RateBadge rate={c.pass_rate} />
                                </div>
                              </div>
                            );
                          })}
                        </Section>

                        <button
                          onClick={loadEvalReport}
                          className="mx-4 flex items-center justify-center gap-2 py-3 rounded-[14px] text-[#007AFF] text-[15px] font-semibold"
                          style={{ backgroundColor: "#F2F2F7" }}
                        >
                          <RefreshCw className="w-4 h-4" />
                          重新整理
                        </button>
                      </>
                    )}

                    {/* ══ 2. OCR 文字辨識準確度 (CER) ══ */}
                    <div className="mx-4 h-px" style={{ backgroundColor: "rgba(60,60,67,0.12)" }} />
                    <p className="mx-4 text-[17px] font-bold text-foreground -mb-2">OCR 文字辨識準確度 (CER)</p>

                    {ocrLoading && (
                      <div className="mx-4 bg-card rounded-[16px] p-8 text-center" style={{ boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" }}>
                        <RefreshCw className="w-6 h-6 mx-auto mb-3 animate-spin" style={{ color: "#007AFF" }} />
                        <p className="text-[15px]" style={{ color: "#8E8E93" }}>載入緊OCR報告…</p>
                      </div>
                    )}

                    {!ocrLoading && ocrError && (
                      <div className="mx-4 bg-card rounded-[16px] p-6 text-center" style={{ boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" }}>
                        <AlertTriangle className="w-8 h-8 mx-auto mb-3" style={{ color: "#FF9500" }} />
                        <p className="text-[15px] text-foreground mb-4">{ocrError}</p>
                        <button onClick={loadOcrReport} className="px-6 py-3 rounded-[14px] text-[#007AFF] text-[15px] font-semibold" style={{ backgroundColor: "#F2F2F7" }}>
                          重新整理
                        </button>
                      </div>
                    )}

                    {!ocrLoading && !ocrError && ocrReport && (
                      <>
                        <div className="mx-4 rounded-[16px] p-5 flex items-center justify-between" style={{ backgroundColor: rateColor(ocrReport.summary.mean_accuracy) }}>
                          <div>
                            <p className="text-white/70 text-[13px] font-medium">平均準確度 (1 − CER)</p>
                            <p className="text-white text-[34px] font-bold leading-none mt-1">
                              {Math.round(ocrReport.summary.mean_accuracy * 100)}%
                            </p>
                            <p className="text-white/70 text-[13px] mt-1">
                              {ocrReport.summary.case_count} 份模擬照片文件 · 模型 {ocrReport.model}
                            </p>
                            <p className="text-white/70 text-[13px]">CER = 編輯距離 ÷ 參考文字長度，數值愈低愈準</p>
                          </div>
                          <ScanText className="w-12 h-12 text-white/80" />
                        </div>

                        <Section label="各文件類型 CER">
                          {ocrReport.cases.map((c, i, arr) => (
                            <Cell
                              key={c.id}
                              label={c.label}
                              sublabel={`CER ${c.cer.toFixed(3)}`}
                              right={<RateBadge rate={c.accuracy} />}
                              last={i === arr.length - 1}
                            />
                          ))}
                        </Section>

                        <button onClick={loadOcrReport} className="mx-4 flex items-center justify-center gap-2 py-3 rounded-[14px] text-[#007AFF] text-[15px] font-semibold" style={{ backgroundColor: "#F2F2F7" }}>
                          <RefreshCw className="w-4 h-4" />
                          重新整理
                        </button>
                      </>
                    )}

                    {/* ══ 3. 100條幻覺風險壓力測試 ══ */}
                    <div className="mx-4 h-px" style={{ backgroundColor: "rgba(60,60,67,0.12)" }} />
                    <p className="mx-4 text-[17px] font-bold text-foreground -mb-2">幻覺風險壓力測試 (100條問題)</p>

                    {hallucinationLoading && (
                      <div className="mx-4 bg-card rounded-[16px] p-8 text-center" style={{ boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" }}>
                        <RefreshCw className="w-6 h-6 mx-auto mb-3 animate-spin" style={{ color: "#007AFF" }} />
                        <p className="text-[15px]" style={{ color: "#8E8E93" }}>載入緊幻覺風險報告…</p>
                      </div>
                    )}

                    {!hallucinationLoading && hallucinationError && (
                      <div className="mx-4 bg-card rounded-[16px] p-6 text-center" style={{ boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" }}>
                        <AlertTriangle className="w-8 h-8 mx-auto mb-3" style={{ color: "#FF9500" }} />
                        <p className="text-[15px] text-foreground mb-4">{hallucinationError}</p>
                        <button onClick={loadHallucinationReport} className="px-6 py-3 rounded-[14px] text-[#007AFF] text-[15px] font-semibold" style={{ backgroundColor: "#F2F2F7" }}>
                          重新整理
                        </button>
                      </div>
                    )}

                    {!hallucinationLoading && !hallucinationError && hallucinationReport && (
                      <>
                        <div
                          className="mx-4 rounded-[16px] p-5 flex items-center justify-between"
                          style={{ backgroundColor: hallucinationReport.summary.hallucination_rate !== null ? hallucinationRateColor(hallucinationReport.summary.hallucination_rate) : "#8E8E93" }}
                        >
                          <div>
                            <p className="text-white/70 text-[13px] font-medium">幻覺率 (目標 &lt;5%)</p>
                            <p className="text-white text-[34px] font-bold leading-none mt-1">
                              {hallucinationReport.summary.hallucination_rate !== null ? `${Math.round(hallucinationReport.summary.hallucination_rate * 100)}%` : "—"}
                            </p>
                            <p className="text-white/70 text-[13px] mt-1">
                              {hallucinationReport.summary.graded_count}/{hallucinationReport.summary.question_count} 條已評審 · 模型 {hallucinationReport.provider}/{hallucinationReport.model}
                            </p>
                            <p className="text-white/70 text-[13px]">
                              評審員：{hallucinationReport.judge_provider}/{hallucinationReport.judge_model}
                            </p>
                            <p className="text-white/70 text-[13px]">
                              平均 {(hallucinationReport.summary.mean_latency_ms / 1000).toFixed(1)}s · P95 {(hallucinationReport.summary.p95_latency_ms / 1000).toFixed(1)}s
                            </p>
                          </div>
                          <AlertTriangle className="w-12 h-12 text-white/80" />
                        </div>

                        <Section label="各類別幻覺率">
                          {Object.entries(hallucinationReport.summary.hallucination_rate_by_category).map(([cat, rate], i, arr) => (
                            <Cell
                              key={cat}
                              label={hallucinationCategoryLabels[cat] ?? cat}
                              right={<HallucinationRateBadge rate={rate} />}
                              last={i === arr.length - 1}
                            />
                          ))}
                        </Section>

                        <Section label="個別問題結果 (100條)">
                          {hallucinationReport.cases.map((c, i, arr) => (
                            <div
                              key={c.id}
                              className={`px-4 py-3 ${i < arr.length - 1 ? "border-b" : ""}`}
                              style={{ borderColor: "rgba(60,60,67,0.12)" }}
                            >
                              <div className="flex items-start gap-2">
                                {c.hallucinated === null
                                  ? <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: "#8E8E93" }} />
                                  : c.hallucinated
                                    ? <XCircle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: "#FF3B30" }} />
                                    : <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: "#34C759" }} />}
                                <div className="flex-1 min-w-0">
                                  <p className="text-[15px] text-foreground leading-snug">{c.question}</p>
                                  <p className="text-[12px] mt-0.5" style={{ color: "#8E8E93" }}>
                                    {hallucinationCategoryLabels[c.category] ?? c.category} · {c.hallucination_risk_focus}
                                  </p>
                                  <ClaimEvidenceReasoning claim={c.claim} evidence={c.evidence} reasoning={c.reasoning} latencyMs={c.latency_ms} />
                                </div>
                                <span
                                  className="text-[12px] font-bold px-2 py-1 rounded-full flex-shrink-0"
                                  style={{
                                    color: c.hallucinated === null ? "#8E8E93" : c.hallucinated ? "#FF3B30" : "#34C759",
                                    backgroundColor: c.hallucinated === null ? "#8E8E9318" : c.hallucinated ? "#FF3B3018" : "#34C75918",
                                  }}
                                >
                                  {c.hallucinated === null ? "未評審" : c.hallucinated ? "亂up" : "安全"}
                                </span>
                              </div>
                            </div>
                          ))}
                        </Section>

                        <button onClick={loadHallucinationReport} className="mx-4 flex items-center justify-center gap-2 py-3 rounded-[14px] text-[#007AFF] text-[15px] font-semibold" style={{ backgroundColor: "#F2F2F7" }}>
                          <RefreshCw className="w-4 h-4" />
                          重新整理
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>

            <TabBar active={tab} onChange={setTab} mode={mode} />
          </>
        )}
      </div>
    </div>
  );
}
