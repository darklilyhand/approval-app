import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";

// ─── 상수 ────────────────────────────────────────────────────
const TEMPLATES = {
  지출결의서: {
    fields: [
      { key: "purpose", label: "지출 목적", type: "text" },
      { key: "amount", label: "지출 금액", type: "number", suffix: "원" },
      { key: "date", label: "지출 일자", type: "date" },
      { key: "vendor", label: "거래처", type: "text" },
      { key: "detail", label: "상세 내역", type: "textarea" },
    ],
  },
  휴가신청서: {
    fields: [
      { key: "vacationType", label: "휴가 종류", type: "select", options: ["연차", "반차(오전)", "반차(오후)", "병가", "특별휴가"] },
      { key: "startDate", label: "시작일", type: "date" },
      { key: "endDate", label: "종료일", type: "date" },
      { key: "reason", label: "사유", type: "textarea" },
      { key: "contact", label: "비상연락처", type: "text" },
    ],
  },
  업무보고서: {
    fields: [
      { key: "period", label: "보고 기간", type: "text", placeholder: "예: 2026년 3월 1주차" },
      { key: "completed", label: "완료 업무", type: "textarea" },
      { key: "inProgress", label: "진행 중 업무", type: "textarea" },
      { key: "planned", label: "예정 업무", type: "textarea" },
      { key: "issues", label: "이슈 / 특이사항", type: "textarea" },
    ],
  },
  자유양식: {
    fields: [
      { key: "subject", label: "제목", type: "text" },
      { key: "content", label: "내용", type: "textarea" },
    ],
  },
};

const STATUS_META = {
  대기중: { color: "#f59e0b", bg: "#fef3c7", icon: "⏳" },
  진행중: { color: "#3b82f6", bg: "#dbeafe", icon: "🔄" },
  승인: { color: "#10b981", bg: "#d1fae5", icon: "✅" },
  반려: { color: "#ef4444", bg: "#fee2e2", icon: "❌" },
  임시저장: { color: "#8b5cf6", bg: "#ede9fe", icon: "📝" },
};

let _docCounter = 0;
const genId = () => {
  const d = new Date();
  const dateStr = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const seq = String(++_docCounter).padStart(3, "0");
  return `${dateStr}-${seq}`;
};
const today = () => new Date().toISOString().split("T")[0];
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }) : "-";
const fmtNum = (n) => Number(n || 0).toLocaleString("ko-KR");

// ─── PDF 출력 ────────────────────────────────────────────────
function printDoc(doc) {
  const fields = TEMPLATES[doc.type]?.fields || [];
  const approvalRows = (doc.approval_line || []).map((u, i) => {
    const st = doc.approval_status?.[i];
    return `<tr>
      <td>${u.name} (${u.title})</td>
      <td>${st?.status || "대기중"}</td>
      <td>${st?.comment || "-"}</td>
      <td>${st?.date ? new Date(st.date).toLocaleDateString("ko-KR") : "-"}</td>
    </tr>`;
  }).join("");
  const fieldRows = fields.map(f => {
    const val = f.key === "amount" ? Number(doc.fields[f.key]||0).toLocaleString("ko-KR") + "원" : (doc.fields[f.key] || "-");
    return `<tr><td style="color:#666;width:120px">${f.label}</td><td><strong>${val}</strong></td></tr>`;
  }).join("");
  const historyRows = (doc.history || []).map(h =>
    `<tr><td>${h.user}</td><td>${h.action}</td><td>${h.note || "-"}</td><td>${h.date ? new Date(h.date).toLocaleDateString("ko-KR") : "-"}</td></tr>`
  ).join("");

  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"/>
  <title>${doc.title}</title>
  <style>
    body { font-family: 'Malgun Gothic', sans-serif; padding: 40px; color: #111; }
    h1 { font-size: 22px; color: #1e3a5f; border-bottom: 3px solid #1e3a5f; padding-bottom: 10px; }
    .meta { color: #666; font-size: 13px; margin-bottom: 24px; }
    .badge { display:inline-block; padding:3px 12px; border-radius:20px; font-weight:700; font-size:13px;
      background:${ doc.status==="승인"?"#d1fae5":doc.status==="반려"?"#fee2e2":"#dbeafe" };
      color:${ doc.status==="승인"?"#059669":doc.status==="반려"?"#dc2626":"#3b82f6" }; }
    h2 { font-size: 15px; color: #374151; margin: 24px 0 10px; border-left: 4px solid #1e3a5f; padding-left: 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 8px; }
    td, th { padding: 8px 12px; border: 1px solid #e5e7eb; }
    th { background: #f3f4f6; font-weight: 700; text-align: left; }
    @media print { button { display: none; } }
  </style></head><body>
  <h1>📋 ${doc.title}</h1>
  <div class="meta">
    문서번호: <strong>${doc.id}</strong> &nbsp;|&nbsp;
    기안일: <strong>${new Date(doc.created_at).toLocaleDateString("ko-KR")}</strong> &nbsp;|&nbsp;
    기안자: <strong>${doc.author_name}</strong> (${doc.author_dept} · ${doc.author_title}) &nbsp;|&nbsp;
    상태: <span class="badge">${doc.status}</span>
  </div>
  <h2>📄 기안 내용</h2>
  <table><tbody>${fieldRows}</tbody></table>
  <h2>👥 결재라인</h2>
  <table><thead><tr><th>결재자</th><th>상태</th><th>의견</th><th>처리일</th></tr></thead><tbody>${approvalRows}</tbody></table>
  <h2>📚 처리 이력</h2>
  <table><thead><tr><th>처리자</th><th>액션</th><th>비고</th><th>일자</th></tr></thead><tbody>${historyRows}</tbody></table>
  <script>window.onload = () => window.print();</script>
  </body></html>`;

  const w = window.open("", "_blank");
  w.document.write(html);
  w.document.close();
}

// ─── 엑셀 내보내기 ───────────────────────────────────────────
function exportExcel(docs) {
  const rows = [
    ["문서번호", "종류", "제목", "기안자", "부서", "직함", "상태", "기안일", "결재라인", "최종처리일"]
  ];
  docs.forEach(d => {
    const line = (d.approval_line || []).map((u, i) => {
      const st = d.approval_status?.[i];
      return `${u.name}(${st?.status || "대기중"})`;
    }).join(" → ");
    const lastDate = [...(d.history || [])].reverse().find(h => h.action !== "기안 제출")?.date || "";
    rows.push([
      d.id, d.type, d.title, d.author_name, d.author_dept, d.author_title,
      d.status, d.created_at ? new Date(d.created_at).toLocaleDateString("ko-KR") : "",
      line,
      lastDate ? new Date(lastDate).toLocaleDateString("ko-KR") : ""
    ]);
  });
  const csv = rows.map(r => r.map(c => `"${String(c||"").replace(/"/g,'""')}"`).join(",")).join("
");
  const bom = "﻿";
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `결재문서_${new Date().toLocaleDateString("ko-KR").replace(/\. /g,"-").replace(".","")}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ─── AI 문서 작성 보조 ────────────────────────────────────────
async function callClaude(prompt) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
        system: "당신은 기업 내부 문서 작성을 도와주는 비서입니다. 요청한 필드에 맞게 JSON 형식으로만 응답하세요. 마크다운 없이 순수 JSON만 출력하세요.",
      }),
    });
    const data = await res.json();
    const text = data.content?.map(i => i.text || "").join("") || "";
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch { return null; }
}

// ════════════════════════════════════════════════════════════
// 메인 앱
// ════════════════════════════════════════════════════════════
export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) loadProfile(session.user.id);
      else setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setSession(session);
      if (session) loadProfile(session.user.id);
      else { setProfile(null); setLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadProfile = async (uid) => {
    const { data } = await supabase.from("profiles").select("*").eq("id", uid).single();
    setProfile(data);
    setLoading(false);
  };

  if (loading) return <Splash />;
  if (!session) return <AuthPage />;
  if (!profile) return <ProfileSetup user={session.user} onDone={() => loadProfile(session.user.id)} />;
  return <MainApp profile={profile} session={session} />;
}

// ─── 로딩 화면 ────────────────────────────────────────────────
function Splash() {
  return (
    <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg,#1e3a5f,#2d6a9f)", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 48 }}>📋</div>
      <div style={{ color: "#fff", fontSize: 20, fontWeight: 800 }}>결재시스템</div>
      <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 14 }}>로딩 중...</div>
    </div>
  );
}

// ─── 로그인 / 회원가입 ────────────────────────────────────────
function AuthPage() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const handle = async () => {
    if (!email || !pw) { setMsg("이메일과 비밀번호를 입력하세요."); return; }
    setLoading(true); setMsg("");
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
      if (error) setMsg("이메일 또는 비밀번호가 올바르지 않습니다.");
    } else {
      const { error } = await supabase.auth.signUp({ email, password: pw });
      if (error) setMsg(error.message);
      else setMsg("가입 완료! 이메일 인증 후 로그인하세요.");
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#1e3a5f,#2d6a9f)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "'Noto Sans KR',sans-serif" }}>
      <div style={{ background: "#fff", borderRadius: 20, padding: "40px 36px", width: "100%", maxWidth: 400, boxShadow: "0 24px 64px rgba(0,0,0,0.3)" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>📋</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#1e3a5f" }}>결재시스템</div>
          <div style={{ fontSize: 13, color: "#9ca3af", marginTop: 4 }}>내부결재 관리 플랫폼</div>
        </div>
        <div style={{ display: "flex", background: "#f3f4f6", borderRadius: 10, padding: 4, marginBottom: 24 }}>
          {["login", "signup"].map(m => (
            <button key={m} onClick={() => { setMode(m); setMsg(""); }} style={{ flex: 1, padding: "9px 0", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 14, background: mode === m ? "#1e3a5f" : "transparent", color: mode === m ? "#fff" : "#6b7280", transition: "all 0.2s" }}>
              {m === "login" ? "로그인" : "회원가입"}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input type="email" placeholder="이메일" value={email} onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handle()}
            style={{ padding: "12px 16px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, outline: "none" }} />
          <input type="password" placeholder="비밀번호 (6자 이상)" value={pw} onChange={e => setPw(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handle()}
            style={{ padding: "12px 16px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, outline: "none" }} />
          {msg && <div style={{ fontSize: 13, color: msg.includes("완료") ? "#059669" : "#ef4444", textAlign: "center" }}>{msg}</div>}
          <button onClick={handle} disabled={loading} style={{ padding: "13px 0", background: "linear-gradient(135deg,#1e3a5f,#2d6a9f)", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1 }}>
            {loading ? "처리 중..." : mode === "login" ? "로그인" : "회원가입"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 최초 프로필 설정 ─────────────────────────────────────────
function ProfileSetup({ user, onDone }) {
  const [name, setName] = useState("");
  const [dept, setDept] = useState("");
  const [title, setTitle] = useState("사원");
  const [loading, setLoading] = useState(false);

  const TITLES = [
    { label: "사원", level: 1 }, { label: "주임", level: 1 }, { label: "대리", level: 1 },
    { label: "팀장", level: 2 }, { label: "과장", level: 2 }, { label: "차장", level: 2 },
    { label: "부장", level: 3 }, { label: "임원", level: 4 },
    { label: "소장", level: 5 },
  ];

  const save = async () => {
    if (!name || !dept) return;
    setLoading(true);
    const t = TITLES.find(t => t.label === title);
    await supabase.from("profiles").insert({ id: user.id, name, dept, title, level: t?.level || 1 });
    onDone();
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#1e3a5f,#2d6a9f)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "'Noto Sans KR',sans-serif" }}>
      <div style={{ background: "#fff", borderRadius: 20, padding: "40px 36px", width: "100%", maxWidth: 400, boxShadow: "0 24px 64px rgba(0,0,0,0.3)" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>👤</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#1e3a5f" }}>프로필 설정</div>
          <div style={{ fontSize: 13, color: "#9ca3af", marginTop: 4 }}>처음 한 번만 입력하면 됩니다</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {[
            { label: "이름", value: name, set: setName, placeholder: "홍길동" },
            { label: "부서", value: dept, set: setDept, placeholder: "예: 개발팀, 경영지원팀" },
          ].map(f => (
            <div key={f.label}>
              <label style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>{f.label}</label>
              <input value={f.value} onChange={e => f.set(e.target.value)} placeholder={f.placeholder}
                style={{ width: "100%", padding: "11px 14px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
            </div>
          ))}
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>직함</label>
            <select value={title} onChange={e => setTitle(e.target.value)} style={{ width: "100%", padding: "11px 14px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, outline: "none", background: "#fff" }}>
              {TITLES.map(t => <option key={t.label} value={t.label}>{t.label}</option>)}
            </select>
          </div>
          <button onClick={save} disabled={!name || !dept || loading} style={{ padding: "13px 0", background: "linear-gradient(135deg,#1e3a5f,#2d6a9f)", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: "pointer", marginTop: 4, opacity: (!name || !dept) ? 0.5 : 1 }}>
            {loading ? "저장 중..." : "시작하기 →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// 메인 앱 (로그인 후)
// ════════════════════════════════════════════════════════════
function MainApp({ profile, session }) {
  const [tab, setTab] = useState("dashboard");
  const [docs, setDocs] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [newDocModal, setNewDocModal] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [dbLoading, setDbLoading] = useState(true);

  // 모든 프로필 로드
  useEffect(() => {
    supabase.from("profiles").select("*").then(({ data }) => {
      if (data) setProfiles(data);
    });
  }, []);

  // 문서 로드
  const loadDocs = useCallback(async () => {
    const { data } = await supabase.from("documents").select("*").order("created_at", { ascending: false });
    if (data) setDocs(data);
    setDbLoading(false);
  }, []);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  // 실시간 동기화
  useEffect(() => {
    const channel = supabase.channel("documents_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "documents" }, () => loadDocs())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [loadDocs]);

  // 선택된 문서 실시간 업데이트
  useEffect(() => {
    if (selectedDoc) {
      const updated = docs.find(d => d.id === selectedDoc.id);
      if (updated) setSelectedDoc(updated);
    }
  }, [docs]);

  const addDoc = async (doc) => {
    await supabase.from("documents").insert(doc);
    setNewDocModal(false);
    setTab("myDocs");
  };

  const approveDoc = async (docId, approverIdx, action, comment) => {
    const doc = docs.find(d => d.id === docId);
    if (!doc) return;
    const newLine = doc.approval_status.map((a, i) =>
      i !== approverIdx ? a : { ...a, status: action, comment, date: today() }
    );
    const allApproved = newLine.every(a => a.status === "승인");
    const anyRejected = newLine.some(a => a.status === "반려");
    const newStatus = anyRejected ? "반려" : allApproved ? "승인" : "진행중";
    const actorName = doc.approval_line[approverIdx]?.name || profile.name;
    const newHistory = [...doc.history, { action, user: actorName, date: today(), note: comment }];
    await supabase.from("documents").update({ approval_status: newLine, status: newStatus, history: newHistory }).eq("id", docId);
  };

  const logout = async () => { await supabase.auth.signOut(); };

  const stats = {
    total: docs.length,
    pending: docs.filter(d => ["대기중", "진행중"].includes(d.status)).length,
    approved: docs.filter(d => d.status === "승인").length,
    rejected: docs.filter(d => d.status === "반려").length,
  };

  const NAV = [
    { key: "dashboard", icon: "📊", label: "대시보드" },
    { key: "myDocs", icon: "📄", label: "내 문서함" },
    { key: "pending", icon: "⏳", label: "결재 대기함" },
    { key: "history", icon: "📚", label: "전체 이력" },
  ];

  return (
    <div style={{ fontFamily: "'Noto Sans KR','Malgun Gothic',sans-serif", minHeight: "100vh", background: "#f0f4f8", display: "flex", flexDirection: "column" }}>
      {/* 헤더 */}
      <header style={{ background: "linear-gradient(135deg,#1e3a5f,#2d6a9f)", color: "#fff", padding: "0 20px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 2px 8px rgba(0,0,0,0.2)", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => setMobileMenu(!mobileMenu)} style={{ background: "none", border: "none", color: "#fff", fontSize: 20, cursor: "pointer", display: "block", padding: "4px 8px" }}>☰</button>
          <span style={{ fontSize: 18, fontWeight: 800 }}>📋 결재시스템</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => setNewDocModal(true)} style={{ padding: "7px 14px", background: "rgba(255,255,255,0.2)", color: "#fff", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 20, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>✏️ 기안</button>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>{profile.name[0]}</div>
            <button onClick={logout} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.7)", fontSize: 12, cursor: "pointer" }}>로그아웃</button>
          </div>
        </div>
      </header>

      <div style={{ display: "flex", flex: 1 }}>
        {/* 사이드바 (슬라이드) */}
        <>
          {mobileMenu && <div onClick={() => setMobileMenu(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 150 }} />}
          <nav style={{
            width: "75vw", maxWidth: 280, background: "#1e3a5f", color: "#fff", padding: "16px 0",
            position: "fixed", top: 56, left: 0, bottom: 0, zIndex: 200,
            transform: mobileMenu ? "translateX(0)" : "translateX(-100%)",
            transition: "transform 0.25s ease",
            overflowY: "auto",
          }}>
            <div style={{ padding: "0 12px 12px", borderBottom: "1px solid rgba(255,255,255,0.1)", marginBottom: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{profile.name}</div>
              <div style={{ fontSize: 12, opacity: 0.6 }}>{profile.dept} · {profile.title}</div>
            </div>
            {NAV.map(m => (
              <button key={m.key} onClick={() => { setTab(m.key); setMobileMenu(false); }} style={{
                width: "100%", padding: "12px 20px", background: tab === m.key ? "rgba(255,255,255,0.15)" : "transparent",
                color: tab === m.key ? "#7dd3fc" : "rgba(255,255,255,0.75)", border: "none", cursor: "pointer",
                textAlign: "left", fontSize: 14, display: "flex", alignItems: "center", gap: 10,
                borderLeft: tab === m.key ? "3px solid #7dd3fc" : "3px solid transparent",
              }}>
                {m.icon} {m.label}
                {m.key === "pending" && stats.pending > 0 && (
                  <span style={{ marginLeft: "auto", background: "#ef4444", color: "#fff", borderRadius: 10, padding: "1px 7px", fontSize: 11, fontWeight: 700 }}>{stats.pending}</span>
                )}
              </button>
            ))}
            <div style={{ margin: "16px 12px 0" }}>
              <button onClick={() => { setNewDocModal(true); setMobileMenu(false); }} style={{ width: "100%", padding: "11px 0", background: "linear-gradient(135deg,#3b82f6,#2563eb)", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
                ✏️ 기안 작성
              </button>
            </div>
          </nav>
        </>

        {/* 메인 콘텐츠 */}
        <main style={{ flex: 1, padding: "20px 16px", overflow: "auto", maxWidth: 900, margin: "0 auto", width: "100%" }}>
          {dbLoading ? (
            <div style={{ textAlign: "center", padding: 60, color: "#9ca3af" }}>📡 데이터 불러오는 중...</div>
          ) : (
            <>
              {tab === "dashboard" && <Dashboard stats={stats} docs={docs} setSelectedDoc={setSelectedDoc} setTab={setTab} />}
              {tab === "myDocs" && <DocList docs={docs.filter(d => d.author_id === profile.id)} title="내 문서함" setSelectedDoc={setSelectedDoc} />}
              {tab === "pending" && <PendingList docs={docs} profile={profile} onApprove={approveDoc} setSelectedDoc={setSelectedDoc} />}
              {tab === "history" && <DocList docs={docs} title="전체 문서 이력" setSelectedDoc={setSelectedDoc} />}
            </>
          )}
        </main>
      </div>

      {/* 모달들 */}
      {selectedDoc && <DocDetailModal doc={selectedDoc} profile={profile} onClose={() => setSelectedDoc(null)} onApprove={approveDoc} />}
      {newDocModal && <NewDocModal onClose={() => setNewDocModal(false)} onSubmit={addDoc} profile={profile} allProfiles={profiles} />}
    </div>
  );
}

// ─── 대시보드 ─────────────────────────────────────────────────
function Dashboard({ stats, docs, setSelectedDoc, setTab }) {
  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: "#1e3a5f", marginBottom: 16 }}>📊 대시보드</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "전체 문서", value: stats.total, icon: "📋", color: "#3b82f6" },
          { label: "결재 대기", value: stats.pending, icon: "⏳", color: "#f59e0b" },
          { label: "승인 완료", value: stats.approved, icon: "✅", color: "#10b981" },
          { label: "반려", value: stats.rejected, icon: "❌", color: "#ef4444" },
        ].map(s => (
          <div key={s.label} style={{ background: "#fff", borderRadius: 12, padding: "16px 20px", boxShadow: "0 1px 4px rgba(0,0,0,0.08)", borderTop: `4px solid ${s.color}` }}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>{s.icon}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>{s.label}</div>
          </div>
        ))}
      </div>
      <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#1e3a5f" }}>최근 문서</h3>
          <button onClick={() => setTab("history")} style={{ fontSize: 12, color: "#3b82f6", background: "none", border: "none", cursor: "pointer" }}>전체보기 →</button>
        </div>
        {docs.slice(0, 5).map(d => <DocRow key={d.id} doc={d} onClick={() => setSelectedDoc(d)} />)}
        {docs.length === 0 && <EmptyState msg="문서가 없습니다." />}
      </div>
    </div>
  );
}

// ─── 문서 목록 ────────────────────────────────────────────────
function DocList({ docs, title, setSelectedDoc }) {
  const [filter, setFilter] = useState("전체");
  const filtered = filter === "전체" ? docs : docs.filter(d => d.status === filter);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#1e3a5f" }}>{title}</h2>
        <button onClick={() => exportExcel(filtered)} style={{ padding: "7px 14px", background: "#059669", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>📊 엑셀 내보내기</button>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {["전체", "대기중", "진행중", "승인", "반려"].map(s => (
          <button key={s} onClick={() => setFilter(s)} style={{ padding: "5px 12px", borderRadius: 20, fontSize: 12, border: "none", cursor: "pointer", background: filter === s ? "#1e3a5f" : "#e5e7eb", color: filter === s ? "#fff" : "#374151", fontWeight: filter === s ? 700 : 400 }}>{s}</button>
        ))}
      </div>
      <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        {filtered.map((d, i) => <DocRow key={d.id} doc={d} onClick={() => setSelectedDoc(d)} noBorder={i === filtered.length - 1} />)}
        {filtered.length === 0 && <EmptyState msg="해당하는 문서가 없습니다." />}
      </div>
    </div>
  );
}

// ─── 결재 대기함 ─────────────────────────────────────────────
function PendingList({ docs, profile, onApprove, setSelectedDoc }) {
  const pending = docs.filter(d => {
    const myIdx = d.approval_line?.findIndex(u => u.id === profile.id);
    if (myIdx < 0 || myIdx === undefined) return false;
    const myStatus = d.approval_status?.[myIdx];
    return myStatus?.status === "대기중" && (myIdx === 0 || d.approval_status?.[myIdx - 1]?.status === "승인");
  });
  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: "#1e3a5f", marginBottom: 14 }}>⏳ 결재 대기함 ({pending.length})</h2>
      <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        {pending.map((d, i) => (
          <DocRow key={d.id} doc={d} onClick={() => setSelectedDoc(d)} noBorder={i === pending.length - 1}
            showActions onAction={(action, comment) => {
              const idx = d.approval_line.findIndex(u => u.id === profile.id);
              onApprove(d.id, idx, action, comment);
            }} />
        ))}
        {pending.length === 0 && <EmptyState msg="결재 대기 문서가 없습니다." />}
      </div>
    </div>
  );
}

// ─── 문서 행 ─────────────────────────────────────────────────
function DocRow({ doc, onClick, noBorder, showActions, onAction }) {
  const [comment, setComment] = useState("");
  const [showComment, setShowComment] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const meta = STATUS_META[doc.status] || STATUS_META["대기중"];

  const handleAction = (action) => {
    if (!showComment) { setPendingAction(action); setShowComment(true); return; }
    onAction(pendingAction, comment);
    setShowComment(false); setComment(""); setPendingAction(null);
  };

  return (
    <div style={{ borderBottom: noBorder ? "none" : "1px solid #f3f4f6" }}>
      <div onClick={onClick} style={{ display: "flex", alignItems: "center", padding: "13px 16px", cursor: "pointer", gap: 10 }}
        onMouseEnter={e => e.currentTarget.style.background = "#f9fafb"}
        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
        <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 20, background: meta.bg, color: meta.color, fontWeight: 700, whiteSpace: "nowrap" }}>
          {meta.icon} {doc.status}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.title}</div>
          <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{doc.author_name} · {fmtDate(doc.created_at)}</div>
        </div>
        {showActions && (
          <div style={{ display: "flex", gap: 6 }} onClick={e => e.stopPropagation()}>
            <button onClick={() => handleAction("승인")} style={{ padding: "5px 10px", background: "#d1fae5", color: "#059669", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer", fontSize: 12 }}>✅ 승인</button>
            <button onClick={() => handleAction("반려")} style={{ padding: "5px 10px", background: "#fee2e2", color: "#dc2626", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer", fontSize: 12 }}>❌ 반려</button>
          </div>
        )}
      </div>
      {showComment && (
        <div style={{ padding: "0 16px 12px", display: "flex", gap: 8 }} onClick={e => e.stopPropagation()}>
          <input value={comment} onChange={e => setComment(e.target.value)} placeholder="의견 입력 (선택)" style={{ flex: 1, padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, outline: "none" }} />
          <button onClick={() => handleAction(pendingAction)} style={{ padding: "8px 14px", background: pendingAction === "승인" ? "#059669" : "#dc2626", color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer", fontSize: 13 }}>확인</button>
          <button onClick={() => { setShowComment(false); setPendingAction(null); setComment(""); }} style={{ padding: "8px 10px", background: "#e5e7eb", color: "#374151", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>취소</button>
        </div>
      )}
    </div>
  );
}

// ─── 문서 상세 모달 ───────────────────────────────────────────
function DocDetailModal({ doc, profile, onClose, onApprove }) {
  const [commentMap, setCommentMap] = useState({});
  const meta = STATUS_META[doc.status] || STATUS_META["대기중"];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 1000 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 720, maxHeight: "92vh", overflow: "auto", boxShadow: "0 -8px 40px rgba(0,0,0,0.2)" }}>
        {/* 핸들 */}
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 0" }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: "#e5e7eb" }} />
        </div>
        {/* 헤더 */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1e3a5f" }}>{doc.title}</div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 3 }}>문서번호: {doc.id} · {fmtDate(doc.created_at)}</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <span style={{ padding: "4px 12px", borderRadius: 20, background: meta.bg, color: meta.color, fontWeight: 700, fontSize: 12 }}>{meta.icon} {doc.status}</span>
            <button onClick={() => printDoc(doc)} style={{ padding: "5px 10px", background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>🖨️ PDF</button>
            <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: "50%", background: "#e5e7eb", border: "none", cursor: "pointer", fontSize: 16 }}>×</button>
          </div>
        </div>

        <div style={{ padding: 20 }}>
          {/* 기안 내용 */}
          <div style={{ background: "#f9fafb", borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 10 }}>📄 기안 내용</h3>
            <div style={{ fontSize: 13 }}>
              <div style={{ marginBottom: 6 }}><span style={{ color: "#6b7280" }}>기안자:</span> <strong>{doc.author_name}</strong> ({doc.author_dept} · {doc.author_title})</div>
              <div style={{ marginBottom: 6 }}><span style={{ color: "#6b7280" }}>종류:</span> <strong>{doc.type}</strong></div>
              <hr style={{ border: "none", borderTop: "1px solid #e5e7eb", margin: "10px 0" }} />
              {TEMPLATES[doc.type]?.fields.map(f => (
                <div key={f.key} style={{ marginBottom: 6 }}>
                  <span style={{ color: "#6b7280" }}>{f.label}:</span>{" "}
                  <strong>{f.key === "amount" ? fmtNum(doc.fields[f.key]) + "원" : doc.fields[f.key] || "-"}</strong>
                </div>
              ))}
            </div>
          </div>

          {/* 결재라인 */}
          <h3 style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 10 }}>👥 결재라인</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
            {doc.approval_line?.map((u, i) => {
              const st = doc.approval_status?.[i];
              const stMeta = STATUS_META[st?.status] || STATUS_META["대기중"];
              const canAct = u.id === profile.id && st?.status === "대기중" && (i === 0 || doc.approval_status?.[i - 1]?.status === "승인");
              return (
                <div key={u.id} style={{ background: stMeta.bg, borderRadius: 10, padding: 14, border: `1px solid ${stMeta.color}30` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{u.name}</span>
                      <span style={{ fontSize: 12, color: "#6b7280" }}> ({u.title})</span>
                    </div>
                    <span style={{ padding: "3px 10px", borderRadius: 20, background: "#fff", color: stMeta.color, fontWeight: 700, fontSize: 12 }}>{stMeta.icon} {st?.status || "대기중"}</span>
                  </div>
                  {st?.comment && <div style={{ marginTop: 8, fontSize: 12, color: "#374151", background: "rgba(255,255,255,0.7)", padding: "6px 10px", borderRadius: 6 }}>💬 {st.comment}</div>}
                  {st?.date && <div style={{ marginTop: 4, fontSize: 11, color: "#9ca3af" }}>{fmtDate(st.date)}</div>}
                  {canAct && (
                    <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
                      <input value={commentMap[i] || ""} onChange={e => setCommentMap(p => ({ ...p, [i]: e.target.value }))} placeholder="의견 (선택)" style={{ flex: 1, padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 12 }} />
                      <button onClick={() => onApprove(doc.id, i, "승인", commentMap[i] || "")} style={{ padding: "7px 12px", background: "#059669", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>승인</button>
                      <button onClick={() => onApprove(doc.id, i, "반려", commentMap[i] || "")} style={{ padding: "7px 12px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>반려</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 이력 */}
          <h3 style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 10 }}>📚 처리 이력</h3>
          <div style={{ background: "#f9fafb", borderRadius: 10, padding: 14 }}>
            {doc.history?.map((h, i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 10 }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#3b82f6", marginTop: 5, flexShrink: 0 }} />
                <div style={{ fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>{h.user}</span>
                  <span style={{ color: "#6b7280" }}> · {h.action}</span>
                  {h.note && <span> — {h.note}</span>}
                  <div style={{ fontSize: 11, color: "#9ca3af" }}>{fmtDate(h.date)}</div>
                </div>
              </div>
            ))}
            {(!doc.history || doc.history.length === 0) && <div style={{ color: "#9ca3af", fontSize: 13 }}>이력 없음</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 기안 작성 모달 ───────────────────────────────────────────
function NewDocModal({ onClose, onSubmit, profile, allProfiles }) {
  const [step, setStep] = useState(1);
  const [docType, setDocType] = useState("지출결의서");
  const [fields, setFields] = useState({});
  const [selectedApprovers, setSelectedApprovers] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);

  const setField = (k, v) => setFields(p => ({ ...p, [k]: v }));

  const handleAI = async () => {
    setAiLoading(true);
    const fieldKeys = TEMPLATES[docType].fields.map(f => f.key).join(", ");
    const result = await callClaude(`${docType} 샘플 문서를 JSON으로만 작성하세요. 키: ${fieldKeys}. 한국어로 현실적으로, 금액은 숫자만.`);
    if (result) setFields(result);
    setAiLoading(false);
  };

  // 결재라인 후보: 본인 제외, level 높은 순
  const approverCandidates = allProfiles
    .filter(p => p.id !== profile.id)
    .sort((a, b) => b.level - a.level);

  const toggleApprover = (p) => {
    setSelectedApprovers(prev =>
      prev.find(x => x.id === p.id) ? prev.filter(x => x.id !== p.id) : [...prev, p]
    );
  };

  // 선택된 결재자를 level 오름차순 정렬
  const sortedApprovers = [...selectedApprovers].sort((a, b) => a.level - b.level);

  const handleSubmit = () => {
    if (sortedApprovers.length === 0) { alert("결재자를 1명 이상 선택하세요."); return; }
    const titleMap = { 지출결의서: fields.purpose || "지출결의", 휴가신청서: fields.vacationType || "휴가", 업무보고서: fields.period || "업무보고", 자유양식: fields.subject || "문서" };
    const approvalLine = sortedApprovers.map(p => ({ id: p.id, name: p.name, title: p.title, dept: p.dept }));
    const doc = {
      id: genId(), type: docType,
      title: `[${docType}] ${titleMap[docType]}`,
      author_id: profile.id, author_name: profile.name,
      author_dept: profile.dept, author_title: profile.title,
      status: "대기중",
      approval_line: approvalLine,
      approval_status: approvalLine.map(() => ({ status: "대기중", comment: "", date: null })),
      fields, history: [{ action: "기안 제출", user: profile.name, date: today(), note: "" }],
    };
    onSubmit(doc);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 600, maxHeight: "92vh", overflow: "auto" }}>
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 0" }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: "#e5e7eb" }} />
        </div>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#1e3a5f" }}>✏️ 기안 작성</h2>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: "50%", background: "#e5e7eb", border: "none", cursor: "pointer", fontSize: 16 }}>×</button>
        </div>

        {/* 스텝 */}
        <div style={{ padding: "14px 20px 0", display: "flex", gap: 6 }}>
          {["문서 선택", "내용 작성", "결재라인"].map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 22, height: 22, borderRadius: "50%", background: step > i + 1 ? "#10b981" : step === i + 1 ? "#3b82f6" : "#e5e7eb", color: step >= i + 1 ? "#fff" : "#9ca3af", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>{step > i + 1 ? "✓" : i + 1}</div>
              <span style={{ fontSize: 12, color: step === i + 1 ? "#3b82f6" : "#9ca3af", fontWeight: step === i + 1 ? 700 : 400 }}>{s}</span>
              {i < 2 && <span style={{ color: "#d1d5db", fontSize: 12 }}>›</span>}
            </div>
          ))}
        </div>

        <div style={{ padding: 20 }}>
          {/* STEP 1 */}
          {step === 1 && (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {Object.keys(TEMPLATES).map(t => (
                  <button key={t} onClick={() => { setDocType(t); setFields({}); }} style={{ padding: 14, border: `2px solid ${docType === t ? "#3b82f6" : "#e5e7eb"}`, borderRadius: 10, background: docType === t ? "#eff6ff" : "#fff", cursor: "pointer", textAlign: "left" }}>
                    <div style={{ fontSize: 22, marginBottom: 4 }}>{({ 지출결의서: "💰", 휴가신청서: "🏖️", 업무보고서: "📊", 자유양식: "📝" })[t]}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: docType === t ? "#3b82f6" : "#111827" }}>{t}</div>
                  </button>
                ))}
              </div>
              <button onClick={() => setStep(2)} style={{ marginTop: 16, width: "100%", padding: 12, background: "#3b82f6", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>다음 →</button>
            </div>
          )}

          {/* STEP 2 */}
          {step === 2 && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <span style={{ fontSize: 14, color: "#6b7280" }}>{docType} 내용 입력</span>
                <button onClick={handleAI} disabled={aiLoading} style={{ padding: "7px 12px", background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: aiLoading ? "not-allowed" : "pointer", opacity: aiLoading ? 0.7 : 1 }}>
                  {aiLoading ? "⏳ 작성 중..." : "✨ AI 자동 작성"}
                </button>
              </div>
              {TEMPLATES[docType].fields.map(f => (
                <div key={f.key} style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>{f.label}</label>
                  {f.type === "textarea" ? (
                    <textarea value={fields[f.key] || ""} onChange={e => setField(f.key, e.target.value)} rows={3} style={{ width: "100%", padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 13, resize: "vertical", outline: "none", boxSizing: "border-box" }} />
                  ) : f.type === "select" ? (
                    <select value={fields[f.key] || ""} onChange={e => setField(f.key, e.target.value)} style={{ width: "100%", padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 13, background: "#fff" }}>
                      <option value="">선택하세요</option>
                      {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <div style={{ display: "flex", gap: 8 }}>
                      <input type={f.type} value={fields[f.key] || ""} onChange={e => setField(f.key, e.target.value)} placeholder={f.placeholder || ""} style={{ flex: 1, padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 13, outline: "none" }} />
                      {f.suffix && <span style={{ fontSize: 13, color: "#6b7280", alignSelf: "center" }}>{f.suffix}</span>}
                    </div>
                  )}
                </div>
              ))}
              <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                <button onClick={() => setStep(1)} style={{ flex: 1, padding: 12, background: "#e5e7eb", color: "#374151", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer" }}>← 이전</button>
                <button onClick={() => setStep(3)} style={{ flex: 2, padding: 12, background: "#3b82f6", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer" }}>다음 →</button>
              </div>
            </div>
          )}

          {/* STEP 3 */}
          {step === 3 && (
            <div>
              <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 12 }}>결재자를 선택하세요. (복수 선택 가능, level 순 자동 정렬)</p>
              {/* 전결 빠른 선택 */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#7c3aed", marginBottom: 8 }}>⚡ 소장 전결 (빠른 선택)</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {allProfiles.filter(p => p.title === "소장").map(p => (
                    <button key={p.id} onClick={() => setSelectedApprovers([p])} style={{ padding: "7px 14px", borderRadius: 8, border: `2px solid ${selectedApprovers.length === 1 && selectedApprovers[0].id === p.id ? "#7c3aed" : "#e5e7eb"}`, background: selectedApprovers.length === 1 && selectedApprovers[0].id === p.id ? "#f5f3ff" : "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#7c3aed" }}>
                      👑 {p.name} 소장
                    </button>
                  ))}
                </div>
              </div>
              {/* 전체 결재자 목록 */}
              <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 8 }}>직접 선택</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16, maxHeight: 220, overflowY: "auto" }}>
                {approverCandidates.map(p => {
                  const isSelected = !!selectedApprovers.find(x => x.id === p.id);
                  return (
                    <button key={p.id} onClick={() => toggleApprover(p)} style={{ padding: "11px 14px", border: `2px solid ${isSelected ? "#3b82f6" : "#e5e7eb"}`, borderRadius: 10, background: isSelected ? "#eff6ff" : "#fff", cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 22, height: 22, borderRadius: "50%", background: isSelected ? "#3b82f6" : "#e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", color: isSelected ? "#fff" : "#9ca3af", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{isSelected ? "✓" : p.name[0]}</div>
                      <div>
                        <span style={{ fontSize: 14, fontWeight: 700, color: isSelected ? "#3b82f6" : "#111827" }}>{p.name}</span>
                        <span style={{ fontSize: 12, color: "#6b7280", marginLeft: 6 }}>{p.dept} · {p.title}</span>
                      </div>
                      {p.title === "소장" && <span style={{ marginLeft: "auto", fontSize: 11, padding: "2px 8px", background: "#ede9fe", color: "#7c3aed", borderRadius: 20, fontWeight: 700 }}>소장</span>}
                    </button>
                  );
                })}
              </div>
              {/* 선택된 결재라인 미리보기 */}
              {sortedApprovers.length > 0 && (
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: 12, marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#059669", marginBottom: 6 }}>✅ 결재라인 미리보기</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {sortedApprovers.map((p, i) => (
                      <span key={p.id} style={{ fontSize: 13, color: "#374151" }}>{i > 0 ? "→ " : ""}<strong>{p.name}</strong> ({p.title})</span>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setStep(2)} style={{ flex: 1, padding: 12, background: "#e5e7eb", color: "#374151", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer" }}>← 이전</button>
                <button onClick={handleSubmit} style={{ flex: 2, padding: 12, background: "linear-gradient(135deg,#059669,#10b981)", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>📤 결재 상신</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ msg }) {
  return <div style={{ padding: 40, textAlign: "center", color: "#9ca3af", fontSize: 14 }}>📭 {msg}</div>;
}
