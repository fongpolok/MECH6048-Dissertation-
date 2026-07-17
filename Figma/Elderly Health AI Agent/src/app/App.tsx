import { useState, useRef, useEffect } from "react";
import {
  MessageCircle, Pill, Heart, Activity, Phone,
  Send, Check, Bell, User, Home,
  Mic, MicOff, Video, Clock, Star, Stethoscope,
  ChevronRight, Wifi, Battery, Signal,
  ShieldCheck, RefreshCw, CheckCircle2, XCircle, AlertTriangle,
} from "lucide-react";
import {
  sendChatMessage, logMedication, submitWellness, alertCaregiver,
  getEvalReport, type ChatTurn, type EvalReport,
} from "./lib/api";

type Tab = "home" | "chat" | "medications" | "wellness" | "consult" | "eval";
type Message = { id: string; role: "user" | "agent"; text: string; time: string };

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

const agentResponses: Record<string, string> = {
  default: "我明白您的情況。可以詳細描述一下您現在的感覺嗎？例如是否有頭暈、胸悶或其他不適？",
  bloodPressure: "高血壓需要特別注意。請問您今日有冇量血壓？如果血壓超過140/90mmHg，請立即聯絡醫生。記得按時服用血壓藥，唔好自行停藥。",
  bloodSugar: "血糖管理對糖尿病患者非常重要。正常空腹血糖應在4.0至7.0 mmol/L之間。如果血糖過高或過低，請即時告知家人或聯絡醫生。",
  headache: "頭痛有時可能係血壓偏高的徵兆。建議您立即量血壓。如果血壓正常，可以先休息，飲多啲水。如果頭痛持續或劇烈，請盡快睇醫生。",
  dizzy: "頭暈可能係血壓波動或血糖偏低引起。請先坐低休息，測一下血糖和血壓。如果血糖低於4.0 mmol/L，請立即飲一杯橙汁。",
  chest: "胸口不適係嚴重警號！請立即按緊急按鈕或致電999。唔好自己開車去醫院，要等救護車。",
  medication: "按時服藥對控制高血壓和糖尿病非常重要。如果您忘記服藥，請查看藥物時間表。切記唔好一次過服兩次劑量。",
  tired: "疲倦感有時與血糖波動有關。請先測一下血糖。記住每日要有充足睡眠，避免過度勞累。",
  foot: "糖尿病患者要特別注意腳部護理。請每日檢查雙腳有冇傷口、紅腫或麻痺感。如發現任何傷口，即使係小傷口，也要盡快睇醫生。",
  diet: "飲食控制對高血壓和糖尿病都非常重要。建議少食多餐，避免高糖、高鹽、高脂食物。多食蔬菜，保持均衡飲食。",
  hello: "您好！我係您的健康助理，專門協助管理高血壓同糖尿病。今日感覺點呀？",
};

function getAgentResponse(msg: string): string {
  const t = msg.toLowerCase();
  if (t.includes("血壓") || t.includes("高血壓")) return agentResponses.bloodPressure;
  if (t.includes("血糖") || t.includes("糖尿")) return agentResponses.bloodSugar;
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

const medications = [
  { name: "氨氯地平", english: "Amlodipine 5mg", time: "早上 8:00", note: "血壓藥", color: "#007AFF", initially: true },
  { name: "二甲雙胍", english: "Metformin 500mg", time: "早上 8:00", note: "糖尿藥", color: "#34C759", initially: true },
  { name: "格列齊特", english: "Gliclazide 30mg", time: "下午 1:00", note: "糖尿藥", color: "#34C759", initially: false },
  { name: "依那普利", english: "Enalapril 10mg", time: "晚上 8:00", note: "血壓藥", color: "#007AFF", initially: false },
];

const wellnessQuestions = [
  { id: 1, q: "今日整體感覺如何？", opts: ["非常好", "良好", "一般", "唔好"] },
  { id: 2, q: "昨晚睡眠質素如何？", opts: ["非常好", "還好", "不太好", "很差"] },
  { id: 3, q: "今日有冇頭暈或頭痛？", opts: ["完全沒有", "輕微", "中等", "嚴重"] },
  { id: 4, q: "今日血糖及血壓是否正常？", opts: ["兩者正常", "血壓偏高", "血糖偏高", "兩者偏高"] },
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

// iOS Status Bar
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

// iOS Navigation Bar
function NavBar({ title, large = false }: { title: string; large?: boolean }) {
  return (
    <div className="bg-card/80 backdrop-blur-xl border-b border-border px-4 pb-3" style={{ WebkitBackdropFilter: "blur(20px)" }}>
      {large ? (
        <h1 className="text-[34px] font-bold text-foreground tracking-tight leading-tight">{title}</h1>
      ) : (
        <h1 className="text-[17px] font-semibold text-foreground text-center">{title}</h1>
      )}
    </div>
  );
}

// iOS Tab Bar
function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs = [
    { id: "home" as Tab, label: "主頁", icon: Home },
    { id: "chat" as Tab, label: "對話", icon: MessageCircle },
    { id: "medications" as Tab, label: "藥物", icon: Pill },
    { id: "wellness" as Tab, label: "健康", icon: Heart },
    { id: "consult" as Tab, label: "醫療", icon: Stethoscope },
    { id: "eval" as Tab, label: "測試", icon: ShieldCheck },
  ];
  return (
    <div
      className="flex border-t bg-card/90 backdrop-blur-xl pb-safe"
      style={{ borderColor: "rgba(60,60,67,0.18)", WebkitBackdropFilter: "blur(20px)" }}
    >
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className="flex-1 flex flex-col items-center gap-0.5 py-2 transition-opacity"
        >
          <tab.icon
            className="w-6 h-6 transition-colors"
            style={{ color: active === tab.id ? "#007AFF" : "#8E8E93" }}
            strokeWidth={active === tab.id ? 2.5 : 1.8}
          />
          <span
            className="text-[10px] font-semibold transition-colors"
            style={{ color: active === tab.id ? "#007AFF" : "#8E8E93" }}
          >
            {tab.label}
          </span>
        </button>
      ))}
    </div>
  );
}

// iOS Section
function Section({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div>
      {label && (
        <p className="text-[13px] font-semibold uppercase px-4 pb-1.5" style={{ color: "#8E8E93", letterSpacing: "0.03em" }}>
          {label}
        </p>
      )}
      <div className="bg-card mx-4 rounded-[12px] overflow-hidden" style={{ boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" }}>
        {children}
      </div>
    </div>
  );
}

// iOS List Cell
function Cell({ icon, iconBg, label, sublabel, right, onPress, last = false, danger = false }: {
  icon?: React.ReactNode; iconBg?: string; label: string; sublabel?: string;
  right?: React.ReactNode; onPress?: () => void; last?: boolean; danger?: boolean;
}) {
  return (
    <button
      className={`w-full flex items-center gap-3 px-4 py-3 text-left active:bg-gray-100 transition-colors ${!last ? "border-b" : ""}`}
      style={{ borderColor: "rgba(60,60,67,0.12)" }}
      onClick={onPress}
    >
      {icon && (
        <div className="w-9 h-9 rounded-[8px] flex items-center justify-center flex-shrink-0" style={{ backgroundColor: iconBg }}>
          {icon}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className={`text-[17px] leading-snug ${danger ? "text-[#FF3B30]" : "text-foreground"}`}>{label}</p>
        {sublabel && <p className="text-[13px] mt-0.5" style={{ color: "#8E8E93" }}>{sublabel}</p>}
      </div>
      {right ?? <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: "#C7C7CC" }} />}
    </button>
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

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [messages, setMessages] = useState<Message[]>([{
    id: "1", role: "agent",
    text: "陳婆婆，早晨！我係您的健康助理，專門幫您管理高血壓同糖尿病。今日感覺點呀？",
    time: "上午 9:00",
  }]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [sos, setSos] = useState(false);
  const [taken, setTaken] = useState<Record<string, boolean>>(Object.fromEntries(medications.map(m => [m.name, m.initially])));
  const [listening, setListening] = useState(false);
  const [booked, setBooked] = useState<string | null>(null);
  const [evalReport, setEvalReport] = useState<EvalReport | null>(null);
  const [evalLoading, setEvalLoading] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const recRef = useRef<SpeechRecognition | null>(null);

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

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, typing]);

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
    const userMsg: Message = { id: Date.now().toString(), role: "user", text: content, time: now };
    const history: ChatTurn[] = messages.map(m => ({ role: m.role, text: m.text }));
    setMessages(p => [...p, userMsg]);
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
  const wellnessDone = Object.keys(answers).length === wellnessQuestions.length;
  const wellnessSubmitted = useRef(false);

  useEffect(() => {
    if (wellnessDone && !wellnessSubmitted.current) {
      wellnessSubmitted.current = true;
      submitWellness(answers).catch(err => console.error("Failed to sync wellness questionnaire", err));
    }
    if (!wellnessDone) {
      wellnessSubmitted.current = false;
    }
  }, [wellnessDone, answers]);

  return (
    <div className="size-full flex items-center justify-center bg-[#1C1C1E]">
      {/* iPhone shell */}
      <div
        className="relative flex flex-col overflow-hidden bg-background"
        style={{
          width: "min(390px, 100%)",
          height: "min(844px, 100%)",
          borderRadius: "min(55px, 8vw)",
          boxShadow: "0 0 0 10px #1C1C1E, 0 40px 80px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(255,255,255,0.12)",
        }}
      >
        {/* Dynamic island */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 w-[120px] h-[35px] bg-black rounded-full z-50" />

        <StatusBar />

        {/* SOS Modal */}
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
              <a href="tel:999" className="block w-full py-4 bg-[#FF3B30] text-white text-center text-[17px] font-semibold rounded-[14px] mb-3">
                致電 999
              </a>
              <button onClick={() => setSos(false)} className="w-full py-4 text-center text-[17px] font-semibold rounded-[14px] text-[#007AFF]" style={{ backgroundColor: "#F2F2F7" }}>
                取消
              </button>
            </div>
          </div>
        )}

        {/* Consult booked sheet */}
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
              <button onClick={() => setBooked(null)} className="w-full py-4 text-[17px] font-semibold rounded-[14px] text-[#007AFF]" style={{ backgroundColor: "#F2F2F7" }}>
                取消
              </button>
            </div>
          </div>
        )}

        {/* Content area */}
        <div className="flex-1 overflow-hidden flex flex-col">

          {/* ── 主頁 ── */}
          {tab === "home" && (
            <>
              <NavBar title="主頁" large />
              <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
                <div className="pt-2 pb-6 space-y-6">
                  {/* Greeting card */}
                  <div className="mx-4 rounded-[16px] overflow-hidden bg-[#007AFF] p-5 flex items-center justify-between">
                    <div>
                      <p className="text-white/70 text-[13px] font-medium">早晨</p>
                      <p className="text-white text-[22px] font-bold">陳婆婆</p>
                      <p className="text-white/70 text-[13px] mt-1">今日健康狀況一覽</p>
                    </div>
                    <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center">
                      <Activity className="w-7 h-7 text-white" />
                    </div>
                  </div>

                  {/* Vitals target */}
                  <Section label="每日目標">
                    <Cell icon={<Activity className="w-5 h-5 text-white" />} iconBg="#007AFF"
                      label="血壓目標" sublabel="< 130/80 mmHg" right={<span className="text-[13px] font-medium text-[#007AFF]">正常</span>} last={false} />
                    <Cell icon={<Heart className="w-5 h-5 text-white" />} iconBg="#34C759"
                      label="空腹血糖目標" sublabel="4.0 – 7.0 mmol/L" right={<span className="text-[13px] font-medium text-[#34C759]">正常</span>} last />
                  </Section>

                  {/* Summary */}
                  <div className="mx-4 grid grid-cols-2 gap-3">
                    <button onClick={() => setTab("medications")} className="bg-card rounded-[16px] p-4 text-left" style={{ boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" }}>
                      <div className="w-10 h-10 bg-[#007AFF]/10 rounded-[10px] flex items-center justify-center mb-3">
                        <Pill className="w-5 h-5 text-[#007AFF]" />
                      </div>
                      <p className="text-[28px] font-bold text-foreground leading-none">
                        {takenCount}<span className="text-[16px] font-semibold text-[#8E8E93]">/{medications.length}</span>
                      </p>
                      <p className="text-[13px] text-[#8E8E93] mt-1">藥物已服用</p>
                      <div className="mt-3 h-1.5 bg-[#F2F2F7] rounded-full overflow-hidden">
                        <div className="h-full bg-[#007AFF] rounded-full transition-all" style={{ width: `${(takenCount / medications.length) * 100}%` }} />
                      </div>
                    </button>
                    <button onClick={() => setTab("wellness")} className="bg-card rounded-[16px] p-4 text-left" style={{ boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" }}>
                      <div className="w-10 h-10 bg-[#FF9500]/10 rounded-[10px] flex items-center justify-center mb-3">
                        <Heart className="w-5 h-5 text-[#FF9500]" />
                      </div>
                      <p className="text-[28px] font-bold text-foreground leading-none">
                        {wellnessDone ? "✓" : `${Object.keys(answers).length}`}
                        {!wellnessDone && <span className="text-[16px] font-semibold text-[#8E8E93]">/{wellnessQuestions.length}</span>}
                      </p>
                      <p className="text-[13px] text-[#8E8E93] mt-1">{wellnessDone ? "問卷完成" : "問題已回答"}</p>
                    </button>
                  </div>

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
                        <Cell key={med.name}
                          icon={<Pill className="w-4 h-4 text-white" />} iconBg={med.color}
                          label={med.name} sublabel={med.english}
                          right={<span className="text-[13px] text-[#8E8E93]">{med.time}</span>}
                          last={i === arr.length - 1} />
                      ))
                    }
                  </Section>

                  {/* Emergency */}
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
                    <div className={`max-w-[78%] px-4 py-2.5 rounded-[18px] text-[16px] leading-relaxed ${
                      m.role === "user"
                        ? "bg-[#007AFF] text-white rounded-br-[4px]"
                        : "bg-card text-foreground rounded-bl-[4px]"
                    }`}
                      style={m.role === "agent" ? { boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" } : {}}
                    >
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
                        {[0, 1, 2].map(i => (
                          <span key={i} className="w-2 h-2 bg-[#8E8E93] rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                <div ref={chatEnd} />
              </div>

              {/* Quick chips */}
              <div className="px-3 py-2 flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
                {["血壓偏高", "血糖過低", "腳部麻痺", "忘記食藥"].map(q => (
                  <button key={q} onClick={() => send(q)}
                    className="flex-shrink-0 px-4 py-1.5 rounded-full border text-[13px] font-medium text-[#007AFF]"
                    style={{ borderColor: "#007AFF", backgroundColor: "rgba(0,122,255,0.06)" }}>
                    {q}
                  </button>
                ))}
              </div>

              {/* Input bar */}
              <div className="px-3 pb-3 flex items-center gap-2 border-t" style={{ borderColor: "rgba(60,60,67,0.18)", paddingTop: "10px" }}>
                <button onClick={toggleMic}
                  className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${listening ? "bg-[#FF3B30]" : "bg-[#F2F2F7]"}`}
                >
                  {listening
                    ? <MicOff className="w-4 h-4 text-white" />
                    : <Mic className="w-4 h-4" style={{ color: "#007AFF" }} />
                  }
                </button>
                <div className="flex-1 flex items-center rounded-full px-4 py-2.5" style={{ backgroundColor: "rgba(118,118,128,0.12)" }}>
                  <input
                    className="flex-1 bg-transparent text-[16px] text-foreground outline-none placeholder:text-[#8E8E93]"
                    placeholder={listening ? "聆聽中…" : "訊息"}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && send()}
                  />
                </div>
                <button
                  onClick={() => send()}
                  disabled={!input.trim()}
                  className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-[#007AFF] disabled:opacity-40 transition-opacity"
                >
                  <Send className="w-4 h-4 text-white" />
                </button>
              </div>
            </>
          )}

          {/* ── 藥物 ── */}
          {tab === "medications" && (
            <>
              <NavBar title="藥物時間表" large />
              <div className="flex-1 overflow-y-auto py-3 space-y-6" style={{ scrollbarWidth: "none" }}>
                {/* Progress */}
                <div className="mx-4 bg-card rounded-[16px] p-4" style={{ boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" }}>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[15px] font-semibold text-foreground">今日進度</p>
                    <p className="text-[15px] font-semibold text-[#007AFF]">{takenCount} / {medications.length}</p>
                  </div>
                  <div className="h-2 bg-[#F2F2F7] rounded-full overflow-hidden">
                    <div className="h-full bg-[#007AFF] rounded-full transition-all duration-500" style={{ width: `${(takenCount / medications.length) * 100}%` }} />
                  </div>
                </div>

                {/* Blood pressure meds */}
                <Section label="血壓藥">
                  {medications.filter(m => m.note === "血壓藥").map((med, i, arr) => (
                    <div key={med.name} className={`px-4 py-3 flex items-center gap-3 ${i < arr.length - 1 ? "border-b" : ""}`} style={{ borderColor: "rgba(60,60,67,0.12)" }}>
                      <div className="w-9 h-9 rounded-[8px] flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#007AFF" }}>
                        <Pill className="w-5 h-5 text-white" />
                      </div>
                      <div className="flex-1">
                        <p className="text-[17px] text-foreground">{med.name}</p>
                        <p className="text-[13px] text-[#8E8E93]">{med.english} · {med.time}</p>
                      </div>
                      <button
                        onClick={() => {
                          const next = !taken[med.name];
                          setTaken(p => ({ ...p, [med.name]: next }));
                          logMedication(med.name, next).catch(err => console.error("Failed to sync medication log", err));
                        }}
                        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all"
                        style={{ backgroundColor: taken[med.name] ? "#34C759" : "rgba(118,118,128,0.18)" }}
                      >
                        {taken[med.name] && <Check className="w-4 h-4 text-white" strokeWidth={3} />}
                      </button>
                    </div>
                  ))}
                </Section>

                {/* Diabetes meds */}
                <Section label="糖尿藥">
                  {medications.filter(m => m.note === "糖尿藥").map((med, i, arr) => (
                    <div key={med.name} className={`px-4 py-3 flex items-center gap-3 ${i < arr.length - 1 ? "border-b" : ""}`} style={{ borderColor: "rgba(60,60,67,0.12)" }}>
                      <div className="w-9 h-9 rounded-[8px] flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#34C759" }}>
                        <Pill className="w-5 h-5 text-white" />
                      </div>
                      <div className="flex-1">
                        <p className="text-[17px] text-foreground">{med.name}</p>
                        <p className="text-[13px] text-[#8E8E93]">{med.english} · {med.time}</p>
                      </div>
                      <button
                        onClick={() => {
                          const next = !taken[med.name];
                          setTaken(p => ({ ...p, [med.name]: next }));
                          logMedication(med.name, next).catch(err => console.error("Failed to sync medication log", err));
                        }}
                        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all"
                        style={{ backgroundColor: taken[med.name] ? "#34C759" : "rgba(118,118,128,0.18)" }}
                      >
                        {taken[med.name] && <Check className="w-4 h-4 text-white" strokeWidth={3} />}
                      </button>
                    </div>
                  ))}
                </Section>
              </div>
            </>
          )}

          {/* ── 健康 ── */}
          {tab === "wellness" && (
            <>
              <NavBar title="每日健康問卷" large />
              <div className="flex-1 overflow-y-auto py-4 space-y-4 px-4" style={{ scrollbarWidth: "none" }}>
                {wellnessDone ? (
                  <div className="bg-card rounded-[16px] p-8 text-center mt-4" style={{ boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" }}>
                    <div className="w-16 h-16 bg-[#34C759]/10 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Check className="w-8 h-8 text-[#34C759]" strokeWidth={3} />
                    </div>
                    <p className="text-[22px] font-bold text-foreground mb-2">完成！</p>
                    <p className="text-[15px] text-[#8E8E93] mb-6">多謝您完成今日問卷。您的醫生可以查閱這些記錄。</p>
                    <button onClick={() => setAnswers({})} className="px-6 py-3 rounded-[14px] text-[#007AFF] text-[17px] font-semibold" style={{ backgroundColor: "#F2F2F7" }}>
                      重新填寫
                    </button>
                  </div>
                ) : wellnessQuestions.map(q => (
                  <div key={q.id} className="bg-card rounded-[16px] overflow-hidden" style={{ boxShadow: "0 0 0 0.5px rgba(60,60,67,0.18)" }}>
                    <div className="px-4 pt-4 pb-3 border-b" style={{ borderColor: "rgba(60,60,67,0.12)" }}>
                      <p className="text-[17px] font-semibold text-foreground">{q.q}</p>
                    </div>
                    <div className="grid grid-cols-2">
                      {q.opts.map((opt, oi) => (
                        <button
                          key={opt}
                          onClick={() => setAnswers(p => ({ ...p, [q.id]: opt }))}
                          className={`py-4 text-[15px] font-medium transition-colors ${
                            oi % 2 === 0 ? "border-r" : ""} ${oi < 2 ? "border-b" : ""}`}
                          style={{
                            borderColor: "rgba(60,60,67,0.12)",
                            color: answers[q.id] === opt ? "#007AFF" : "#000",
                            backgroundColor: answers[q.id] === opt ? "rgba(0,122,255,0.06)" : "transparent",
                            fontWeight: answers[q.id] === opt ? 600 : 400,
                          }}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── 醫療諮詢 ── */}
          {tab === "consult" && (
            <>
              <NavBar title="即時醫療諮詢" large />
              <div className="flex-1 overflow-y-auto py-3 space-y-6" style={{ scrollbarWidth: "none" }}>
                {/* How it works */}
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
                        <div className="w-12 h-12 rounded-full flex items-center justify-center text-white text-[20px] font-bold flex-shrink-0" style={{ backgroundColor: doc.bg }}>
                          {doc.initials}
                        </div>
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
                      <button
                        onClick={() => doc.available && setBooked(doc.name)}
                        disabled={!doc.available}
                        className="w-full py-3 rounded-[12px] text-[15px] font-semibold flex items-center justify-center gap-2 transition-opacity disabled:opacity-40"
                        style={{ backgroundColor: "#007AFF", color: "#fff" }}
                      >
                        <Video className="w-4 h-4" />
                        {doc.available ? "立即視訊問診" : "暫時不可預約"}
                      </button>
                    </div>
                  ))}
                </Section>
              </div>
            </>
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
      </div>
    </div>
  );
}
