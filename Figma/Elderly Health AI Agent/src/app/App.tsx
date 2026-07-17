import { useState, useRef, useEffect } from "react";
import {
  MessageCircle, Pill, Heart, Activity, Phone,
  Send, Check, Bell, User, Home,
  Mic, MicOff, Video, Clock, Star, Stethoscope,
  ChevronRight, Wifi, Battery, Signal, Plus, X,
  TrendingUp, BarChart2, Settings, ChevronLeft,
  ShieldCheck, RefreshCw, CheckCircle2, XCircle, AlertTriangle,
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Legend,
} from "recharts";
import {
  sendChatMessage, logMedication, alertCaregiver,
  logBPRecord, getBPRecords, logHbA1cRecord, getHbA1cRecords,
  getEvalReport, type ChatTurn, type EvalReport,
} from "./lib/api";

type Tab = "home" | "chat" | "medications" | "records" | "consult" | "settings" | "eval";
type Message = { id: string; role: "user" | "agent"; text: string; time: string };
type Profile = { name: string; age: string; gender: "男" | "女" | "" };
type BPEntry = { date: string; sys: number; dia: number };
type HbA1cEntry = { date: string; value: number };

const evalCategoryLabels: Record<string, string> = {
  grounded_fact: "資料準確度 (Grounded Facts)",
  safety_critical: "緊急安全觸發 (Safety-Critical)",
  hallucination_trap: "防止亂up資料 (Hallucination Trap)",
  tool_claim_consistency: "工具動作一致性 (Tool-Claim)",
};

function rateColor(rate: number): string {
  if (rate >= 0.9) return "#34C759";
  if (rate >= 0.5) return "#FF9500";
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
const medications = [
  { name: "氨氯地平", english: "Amlodipine 5mg", time: "早上 8:00", note: "血壓藥", color: "#007AFF", initially: true },
  { name: "二甲雙胍", english: "Metformin 500mg", time: "早上 8:00", note: "糖尿藥", color: "#34C759", initially: true },
  { name: "格列齊特", english: "Gliclazide 30mg", time: "下午 1:00", note: "糖尿藥", color: "#34C759", initially: false },
  { name: "依那普利", english: "Enalapril 10mg", time: "晚上 8:00", note: "血壓藥", color: "#007AFF", initially: false },
];

const defaultBP: BPEntry[] = [
  { date: "1月", sys: 148, dia: 92 },
  { date: "2月", sys: 142, dia: 88 },
  { date: "3月", sys: 138, dia: 86 },
  { date: "4月", sys: 135, dia: 84 },
  { date: "5月", sys: 132, dia: 82 },
  { date: "6月", sys: 128, dia: 80 },
  { date: "7月", sys: 130, dia: 81 },
];

const defaultHbA1c: HbA1cEntry[] = [
  { date: "1月", value: 8.2 },
  { date: "3月", value: 7.8 },
  { date: "5月", value: 7.4 },
  { date: "7月", value: 7.1 },
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

function NavBar({ title, large = false, rightEl }: { title: string; large?: boolean; rightEl?: React.ReactNode }) {
  return (
    <div className="bg-card/80 backdrop-blur-xl border-b border-border px-4 pb-3 flex items-end justify-between" style={{ WebkitBackdropFilter: "blur(20px)" }}>
      {large
        ? <h1 className="text-[34px] font-bold text-foreground tracking-tight leading-tight">{title}</h1>
        : <h1 className="flex-1 text-[17px] font-semibold text-foreground text-center">{title}</h1>
      }
      {rightEl && <div className="ml-2">{rightEl}</div>}
    </div>
  );
}

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs = [
    { id: "home" as Tab, label: "主頁", icon: Home },
    { id: "chat" as Tab, label: "對話", icon: MessageCircle },
    { id: "medications" as Tab, label: "藥物", icon: Pill },
    { id: "records" as Tab, label: "記錄", icon: TrendingUp },
    { id: "consult" as Tab, label: "醫療", icon: Stethoscope },
    { id: "settings" as Tab, label: "設定", icon: Settings },
    { id: "eval" as Tab, label: "測試", icon: ShieldCheck },
  ];
  return (
    <div className="flex border-t bg-card/90 backdrop-blur-xl pb-safe" style={{ borderColor: "rgba(60,60,67,0.18)", WebkitBackdropFilter: "blur(20px)" }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)} className="flex-1 flex flex-col items-center gap-0.5 py-1.5 transition-opacity">
          <t.icon className="w-5 h-5 transition-colors" style={{ color: active === t.id ? "#007AFF" : "#8E8E93" }} strokeWidth={active === t.id ? 2.5 : 1.8} />
          <span className="text-[9px] font-semibold" style={{ color: active === t.id ? "#007AFF" : "#8E8E93" }}>{t.label}</span>
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
function AddBPModal({ onAdd, onClose }: { onAdd: (e: BPEntry) => void; onClose: () => void }) {
  const [sys, setSys] = useState("");
  const [dia, setDia] = useState("");
  const months = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
  const [month, setMonth] = useState(months[new Date().getMonth()]);
  const valid = sys.trim() && dia.trim() && Number(sys) > 0 && Number(dia) > 0;
  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end bg-black/50 backdrop-blur-sm">
      <div className="bg-card rounded-t-[20px] px-6 pt-5 pb-8">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-[20px] font-bold text-foreground">新增血壓記錄</h3>
          <button onClick={onClose}><X className="w-6 h-6" style={{ color: "#8E8E93" }} /></button>
        </div>
        <div className="space-y-4">
          <div>
            <p className="text-[13px] font-semibold uppercase mb-1 px-1" style={{ color: "#8E8E93", letterSpacing: "0.04em" }}>月份</p>
            <div className="flex gap-2 flex-wrap">
              {months.slice(0, 7).map(m => (
                <button key={m} onClick={() => setMonth(m)}
                  className="px-3 py-1.5 rounded-full text-[13px] font-semibold transition-all"
                  style={{ backgroundColor: month === m ? "#007AFF" : "#F2F2F7", color: month === m ? "#fff" : "#000" }}>
                  {m}
                </button>
              ))}
            </div>
          </div>
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
          onClick={() => { if (valid) { onAdd({ date: month, sys: Number(sys), dia: Number(dia) }); onClose(); } }}
          disabled={!valid}
          className="w-full py-4 rounded-[14px] text-white text-[17px] font-semibold mt-5 disabled:opacity-40 transition-opacity"
          style={{ backgroundColor: "#007AFF" }}
        >
          儲存記錄
        </button>
      </div>
    </div>
  );
}

// ── Add HbA1c Modal ───────────────────────────────────────────────────────────
function AddHbA1cModal({ onAdd, onClose }: { onAdd: (e: HbA1cEntry) => void; onClose: () => void }) {
  const [val, setVal] = useState("");
  const months = ["1月","3月","5月","7月","9月","11月"];
  const [month, setMonth] = useState(months[0]);
  const valid = val.trim() && Number(val) > 0;
  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end bg-black/50 backdrop-blur-sm">
      <div className="bg-card rounded-t-[20px] px-6 pt-5 pb-8">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-[20px] font-bold text-foreground">新增 HbA1c 記錄</h3>
          <button onClick={onClose}><X className="w-6 h-6" style={{ color: "#8E8E93" }} /></button>
        </div>
        <div className="space-y-4">
          <div>
            <p className="text-[13px] font-semibold uppercase mb-1 px-1" style={{ color: "#8E8E93", letterSpacing: "0.04em" }}>月份</p>
            <div className="flex gap-2 flex-wrap">
              {months.map(m => (
                <button key={m} onClick={() => setMonth(m)}
                  className="px-3 py-1.5 rounded-full text-[13px] font-semibold transition-all"
                  style={{ backgroundColor: month === m ? "#FF9500" : "#F2F2F7", color: month === m ? "#fff" : "#000" }}>
                  {m}
                </button>
              ))}
            </div>
          </div>
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
          onClick={() => { if (valid) { onAdd({ date: month, value: Number(val) }); onClose(); } }}
          disabled={!valid}
          className="w-full py-4 rounded-[14px] text-white text-[17px] font-semibold mt-5 disabled:opacity-40 transition-opacity"
          style={{ backgroundColor: "#FF9500" }}
        >
          儲存記錄
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
function HbA1cTooltip({ active, payload, label }: { active?: boolean; payload?: {value:number}[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card rounded-[10px] px-3 py-2 shadow-lg" style={{ boxShadow: "0 4px 20px rgba(0,0,0,0.12)" }}>
      <p className="text-[12px] font-semibold mb-1" style={{ color: "#8E8E93" }}>{label}</p>
      <p className="text-[13px] font-bold" style={{ color: "#FF9500" }}>HbA1c: {payload[0].value}%</p>
    </div>
  );
}

// ── Settings Tab ─────────────────────────────────────────────────────────────
function SettingsTab({ profile, onSave }: { profile: Profile; onSave: (p: Profile) => void }) {
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
        </div>

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

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
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
  const [hbData, setHbData] = useState<HbA1cEntry[]>(defaultHbA1c);
  const [showAddBP, setShowAddBP] = useState(false);
  const [showAddHb, setShowAddHb] = useState(false);
  const [evalReport, setEvalReport] = useState<EvalReport | null>(null);
  const [evalLoading, setEvalLoading] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const recRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, typing]);

  // Hydrate real BP/HbA1c history from the backend once, on load — falls back
  // to the bundled demo series (defaultBP/defaultHbA1c) if the backend has no
  // records yet or is unreachable.
  useEffect(() => {
    getBPRecords().then(records => { if (records.length > 0) setBpData(records); }).catch(() => {});
    getHbA1cRecords().then(records => { if (records.length > 0) setHbData(records); }).catch(() => {});
  }, []);

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

  useEffect(() => {
    if (tab === "eval" && !evalReport && !evalLoading) {
      loadEvalReport();
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
      const { reply } = await sendChatMessage(content, history);
      setMessages(p => [...p, { id: (Date.now() + 1).toString(), role: "agent", text: reply, time: now }]);
    } catch (err) {
      // Backend/Ollama unreachable — fall back to the local offline demo responses
      // so the app (and especially the emergency-symptom flow) never goes silent.
      console.error("Chat API unavailable, using offline demo response", err);
      setMessages(p => [...p, { id: (Date.now() + 1).toString(), role: "agent", text: getAgentResponse(content), time: now }]);
    } finally {
      setTyping(false);
    }
  }

  const takenCount = Object.values(taken).filter(Boolean).length;
  const latestBP = bpData[bpData.length - 1];
  const latestHb = hbData[hbData.length - 1];
  const bpStatus = latestBP.sys < 130 && latestBP.dia < 80 ? { label: "正常", color: "#34C759" } : latestBP.sys >= 140 ? { label: "偏高", color: "#FF3B30" } : { label: "輕微偏高", color: "#FF9500" };
  const hbStatus = latestHb.value < 7 ? { label: "達標", color: "#34C759" } : latestHb.value < 8 ? { label: "輕微偏高", color: "#FF9500" } : { label: "偏高", color: "#FF3B30" };

  const displayName = profile?.name ?? "用戶";

  return (
    <div className="size-full flex items-center justify-center bg-[#1C1C1E]">
      <div className="relative flex flex-col overflow-hidden bg-background"
        style={{ width: "min(390px, 100%)", height: "min(844px, 100%)", borderRadius: "min(55px, 8vw)", boxShadow: "0 0 0 10px #1C1C1E, 0 40px 80px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(255,255,255,0.12)" }}>

        {/* Dynamic island */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 w-[120px] h-[35px] bg-black rounded-full z-50" />

        <StatusBar />

        {/* ── Onboarding ── */}
        {!profile && <OnboardingPage onDone={p => {
          setProfile(p);
          setMessages([{ id: "1", role: "agent", text: `${p.name}，早晨！我係您的健康助理，專門幫您管理高血壓同糖尿病。今日感覺點呀？`, time: "上午 9:00" }]);
        }} />}

        {/* ── Main app ── */}
        {profile && (
          <>
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

            {/* Add BP / HbA1c modals */}
            {showAddBP && (
              <AddBPModal
                onAdd={e => {
                  setBpData(p => [...p, e]);
                  logBPRecord(e).catch(err => console.error("Failed to sync BP record", err));
                }}
                onClose={() => setShowAddBP(false)}
              />
            )}
            {showAddHb && (
              <AddHbA1cModal
                onAdd={e => {
                  setHbData(p => [...p, e]);
                  logHbA1cRecord(e).catch(err => console.error("Failed to sync HbA1c record", err));
                }}
                onClose={() => setShowAddHb(false)}
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

                      {/* Vitals summary */}
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

                      {/* Medications summary */}
                      <Section label="今日藥物">
                        <Cell icon={<Pill className="w-5 h-5 text-white" />} iconBg="#007AFF"
                          label={`${takenCount} / ${medications.length} 已服用`} sublabel="點擊查看詳情"
                          onPress={() => setTab("medications")} last />
                      </Section>

                      {/* Quick chat */}
                      <Section label="快速提問">
                        {quickPrompts.map((q, i) => (
                          <Cell key={q} icon={<MessageCircle className="w-4 h-4 text-white" />} iconBg="#007AFF"
                            label={q} onPress={() => { setTab("chat"); setTimeout(() => send(q), 200); }}
                            last={i === quickPrompts.length - 1} />
                        ))}
                      </Section>

                      {/* Reminders */}
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

              {/* ── 對話 ── */}
              {tab === "chat" && (
                <>
                  <NavBar title="健康助理" />
                  <div className="flex-1 overflow-y-auto px-3 py-4 space-y-3" style={{ scrollbarWidth: "none" }}>
                    {messages.map(m => (
                      <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} items-end gap-2`}>
                        {m.role === "agent" && (
                          <div className="w-8 h-8 rounded-full bg-[#007AFF] flex items-center justify-center flex-shrink-0 mb-1">
                            <Activity className="w-4 h-4 text-white" />
                          </div>
                        )}
                        <div className={`max-w-[78%] px-4 py-2.5 rounded-[18px] text-[16px] leading-relaxed ${m.role === "user" ? "bg-[#007AFF] text-white rounded-br-[4px]" : "bg-card text-foreground rounded-bl-[4px]"}`}
                          style={m.role === "agent" ? { boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" } : {}}>
                          {m.text}
                        </div>
                      </div>
                    ))}
                    {typing && (
                      <div className="flex items-end gap-2">
                        <div className="w-8 h-8 rounded-full bg-[#007AFF] flex items-center justify-center">
                          <Activity className="w-4 h-4 text-white" />
                        </div>
                        <div className="bg-card px-4 py-3 rounded-[18px] rounded-bl-[4px]" style={{ boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" }}>
                          <div className="flex gap-1 items-center h-5">
                            {[0, 1, 2].map(i => <span key={i} className="w-2 h-2 bg-[#8E8E93] rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={chatEnd} />
                  </div>

                  <div className="flex-shrink-0 flex flex-col items-center bg-card/80 backdrop-blur-xl border-t pb-3"
                    style={{ borderColor: "rgba(60,60,67,0.18)", WebkitBackdropFilter: "blur(20px)" }}>
                    <div className="w-full px-3 pt-3 pb-2 flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
                      {["血壓偏高", "血糖過低", "腳部麻痺", "忘記食藥"].map(q => (
                        <button key={q} onClick={() => send(q)} className="flex-shrink-0 px-4 py-1.5 rounded-full border text-[13px] font-medium text-[#007AFF]"
                          style={{ borderColor: "#007AFF", backgroundColor: "rgba(0,122,255,0.06)" }}>{q}</button>
                      ))}
                    </div>
                    <div className="flex flex-col items-center py-4 gap-2">
                      <div className="relative flex items-center justify-center">
                        {listening && (
                          <>
                            <span className="absolute w-28 h-28 rounded-full bg-[#007AFF]/10 animate-ping" style={{ animationDuration: "1.2s" }} />
                            <span className="absolute w-36 h-36 rounded-full bg-[#007AFF]/05 animate-ping" style={{ animationDuration: "1.6s", animationDelay: "0.2s" }} />
                          </>
                        )}
                        <button onClick={toggleMic}
                          className="relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-200 active:scale-95"
                          style={{
                            background: listening ? "linear-gradient(145deg,#FF3B30,#FF2D55)" : "linear-gradient(145deg,#007AFF,#5AC8FA)",
                            boxShadow: listening ? "0 8px 32px rgba(255,59,48,0.45)" : "0 8px 32px rgba(0,122,255,0.40)",
                          }}>
                          {listening ? <MicOff className="w-9 h-9 text-white" /> : <Mic className="w-9 h-9 text-white" />}
                        </button>
                      </div>
                      <p className="text-[13px] font-medium" style={{ color: listening ? "#FF3B30" : "#8E8E93" }}>
                        {listening ? "聆聽中，輕按停止" : "輕按說話"}
                      </p>
                    </div>
                    <div className="w-full px-3 flex items-center gap-2">
                      <div className="flex-1 flex items-center rounded-full px-4 py-2.5" style={{ backgroundColor: "rgba(118,118,128,0.12)" }}>
                        <input className="flex-1 bg-transparent text-[16px] text-foreground outline-none placeholder:text-[#8E8E93]"
                          placeholder={listening ? "聆聽中…" : "或者輸入文字…"} value={input}
                          onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} />
                      </div>
                      <button onClick={() => send()} disabled={!input.trim()}
                        className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-[#007AFF] disabled:opacity-40 transition-opacity">
                        <Send className="w-4 h-4 text-white" />
                      </button>
                    </div>
                  </div>
                </>
              )}

              {/* ── 藥物 ── */}
              {tab === "medications" && (
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
              {tab === "records" && (
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
                          <button onClick={() => setShowAddBP(true)}
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

                    {/* Recent BP readings */}
                    <Section label="血壓記錄">
                      {[...bpData].reverse().slice(0, 4).map((r, i, arr) => {
                        const s = r.sys < 130 && r.dia < 80 ? { label: "正常", color: "#34C759" } : r.sys >= 140 ? { label: "偏高", color: "#FF3B30" } : { label: "輕微偏高", color: "#FF9500" };
                        return (
                          <div key={i} className={`px-4 py-3 flex items-center justify-between ${i < arr.length - 1 ? "border-b" : ""}`} style={{ borderColor: "rgba(60,60,67,0.12)" }}>
                            <div>
                              <p className="text-[17px] font-semibold text-foreground">{r.sys}/{r.dia} <span className="text-[13px] font-normal text-[#8E8E93]">mmHg</span></p>
                              <p className="text-[13px] text-[#8E8E93]">{r.date}</p>
                            </div>
                            <span className="text-[12px] font-bold px-2.5 py-1 rounded-full" style={{ backgroundColor: s.color + "18", color: s.color }}>{s.label}</span>
                          </div>
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
                          <button onClick={() => setShowAddHb(true)}
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

                    {/* Recent HbA1c readings */}
                    <Section label="HbA1c 記錄">
                      {[...hbData].reverse().map((r, i, arr) => {
                        const s = r.value < 7 ? { label: "達標", color: "#34C759" } : r.value < 8 ? { label: "輕微偏高", color: "#FF9500" } : { label: "偏高", color: "#FF3B30" };
                        return (
                          <div key={i} className={`px-4 py-3 flex items-center justify-between ${i < arr.length - 1 ? "border-b" : ""}`} style={{ borderColor: "rgba(60,60,67,0.12)" }}>
                            <div>
                              <p className="text-[17px] font-semibold text-foreground">{r.value}% <span className="text-[13px] font-normal text-[#8E8E93]">HbA1c</span></p>
                              <p className="text-[13px] text-[#8E8E93]">{r.date}</p>
                            </div>
                            <span className="text-[12px] font-bold px-2.5 py-1 rounded-full" style={{ backgroundColor: s.color + "18", color: s.color }}>{s.label}</span>
                          </div>
                        );
                      })}
                    </Section>
                  </div>
                </>
              )}

              {/* ── 醫療諮詢 ── */}
              {tab === "consult" && (
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

              {/* ── 設定 ── */}
              {tab === "settings" && profile && (
                <SettingsTab profile={profile} onSave={setProfile} />
              )}

              {/* ── 測試 (Testing & Hallucination Evaluation) ── */}
              {tab === "eval" && (
                <>
                  <NavBar title="測試同評估" large />
                  <div className="flex-1 overflow-y-auto py-3 space-y-6" style={{ scrollbarWidth: "none" }}>
                    <p className="mx-4 text-[13px]" style={{ color: "#8E8E93" }}>
                      下面嘅結果嚟自 <code>eval/evaluate.py</code> 對真實 Ollama 模型嘅測試，用嚟檢查回答有冇根據官方指引、
                      有冇喺急症徵狀時提示999，同埋有冇「亂up」答案（hallucination）。
                    </p>

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
                              {evalReport.cases.length} 條測試問題 · 每條重複 {evalReport.repeat} 次
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
                        <Section label="個別測試結果">
                          {evalReport.cases.map((c, i, arr) => {
                            const passed = c.pass_rate === 1;
                            const failedRuns = c.runs.filter(r => !r.pass);
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
                  </div>
                </>
              )}
            </div>

            <TabBar active={tab} onChange={setTab} />
          </>
        )}
      </div>
    </div>
  );
}
