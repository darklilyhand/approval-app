import { useState, useEffect, useCallback } from "react";
import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, WidthType, AlignmentType, BorderStyle, ShadingType, HeadingLevel } from "docx";
import { saveAs } from "file-saver";
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
  공문서: {
    fields: [
      { key: "receiver", label: "수신", type: "text", placeholder: "예: 묘한 LAB 소장" },
      { key: "reference", label: "참조", type: "text", placeholder: "예: 묘한박물관 학예사" },
      { key: "subject", label: "제목", type: "text" },
      { key: "body", label: "본문 내용", type: "textarea" },
      { key: "attachments", label: "붙임", type: "textarea", placeholder: "예: 붙임 1. 서류전형 평정표" },
    ],
  },
};

const STATUS_META = {
  대기중: { color: "#5b9fd4", bg: "#e8f2fb", icon: "⏳" },
  진행중: { color: "#3ba8b8", bg: "#e2f4f7", icon: "🔄" },
  승인: { color: "#4db8a8", bg: "#e2f5f2", icon: "✅" },
  반려: { color: "#7a9ebe", bg: "#edf3f8", icon: "❌" },
  임시저장: { color: "#7ab8cc", bg: "#e8f4f8", icon: "📝" },
  회수: { color: "#8aacbe", bg: "#edf3f7", icon: "↩️" },
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

// ─── .docx 생성 ──────────────────────────────────────────────────
async function exportDocToWord(doc, orgName) {
  const ROLES = ["직원", "대리", "과장", "팀장", "실장", "관장"];
  const fields = TEMPLATES[doc.type]?.fields || [];

  // ── 공통 헬퍼 ──────────────────────────────────────────────
  const B = (color="AAAAAA", sz=4) => ({ style: BorderStyle.SINGLE, size: sz, color });
  const BD = { top:B(),bottom:B(),left:B(),right:B() };
  const t = (text, opts={}) => new TextRun({ text: String(text||""), size: 22, font:"맑은 고딕", ...opts });
  const p = (children, opts={}) => new Paragraph({
    children: Array.isArray(children) ? children : [children],
    ...opts
  });
  const emptyP = () => p(t(""), { spacing:{ before:0, after:0 } });

  // ── 공문서 양식 ─────────────────────────────────────────────
  if (doc.type === "공문서") {
    const ORG = {
      "묘한 LAB":   { name:"묘한 LAB",   addr:"(03132) 서울특별시 종로구 삼일대로 30길 21, 203호 (낙원동, 종로오피스텔)", tel:"02-764-7894", fax:"02-764-7891", email:"precuratorkp@gmail.com", web:"http://www.pmuseums.org" },
      "묘한박물관": { name:"묘한박물관", addr:"(03132) 서울특별시 종로구 삼일대로 30길 21, 203호 (낙원동, 종로오피스텔)", tel:"02-764-7894", fax:"02-764-7891", email:"precuratorkp@gmail.com", web:"http://www.pmuseums.org" },
    };
    const org = ORG[orgName] || ORG["묘한 LAB"];
    const docDate = new Date(doc.created_at).toLocaleDateString("ko-KR",{year:"numeric",month:"long",day:"numeric"});

    // 결재자 이름 줄: "직원 배하은   대리 윤기은   ..."
    const stampLine = ROLES.map(role => {
      const idx = (doc.approval_line||[]).findIndex(u => u.title === role);
      const name = idx >= 0 ? doc.approval_line[idx].name : "　　　";
      return `${role}  ${name}`;
    }).join("        ");

    // 공문 내용 테이블 (수신/참조/제목/본문/붙임)
    const mkRow = (label, value, bold=false) => new TableRow({ children:[
      new TableCell({
        children:[p(t(label,{bold:true,size:20,font:"맑은 고딕"}))],
        shading:{type:ShadingType.CLEAR, fill:"EFF6FF"},
        width:{size:2000, type:WidthType.DXA},
        borders:BD,
      }),
      new TableCell({
        children:[p(t(value,{bold,size:22,font:"맑은 고딕"}))],
        width:{size:7000, type:WidthType.DXA},
        borders:BD,
      }),
    ]});

    const bodyLines = (doc.fields.body||"").split("\n");
    const attachLines = (doc.fields.attachments||"").split("\n");

    const contentTable = new Table({
      width:{size:9000, type:WidthType.DXA},
      rows:[
        mkRow("수  신", doc.fields.receiver||""),
        mkRow("참  조", doc.fields.reference||""),
        mkRow("제  목", doc.fields.subject||"", true),
        new TableRow({ children:[new TableCell({
          columnSpan:2,
          width:{size:9000, type:WidthType.DXA},
          borders:BD,
          children:[
            emptyP(),
            ...bodyLines.map(line => p(t(line,{size:22,font:"맑은 고딕"}),{spacing:{line:360,before:0,after:0}})),
            emptyP(),
            ...(doc.fields.attachments ? [
              emptyP(),
              ...attachLines.map((line,i) => p(t((i===0?"붙  임  ":"          ")+line,{size:22,font:"맑은 고딕"}),{spacing:{after:0}})),
            ]:[]),
            emptyP(),
          ],
        })]},
      ),
      ],
    });

    // 하단 시행 정보 테이블
    const footerTable = new Table({
      width:{size:9000, type:WidthType.DXA},
      borders:{ top:B("1e3a5f",8), bottom:B(), left:B(), right:B(), insideH:B(), insideV:B() },
      rows:[new TableRow({children:[new TableCell({
        width:{size:9000, type:WidthType.DXA},
        borders:BD,
        children:[
          p(t(stampLine,{size:18,font:"맑은 고딕"}),{spacing:{before:100,after:100}, border:{bottom:{style:BorderStyle.SINGLE,size:4,color:"CCCCCC"}}}),
          p(t(`시행 : ${org.name} ${doc.id}  (${docDate})`,{size:18,font:"맑은 고딕"}),{spacing:{before:80,after:40}}),
          p(t(`주소 : ${org.addr}`,{size:18,font:"맑은 고딕"}),{spacing:{after:40}}),
          p([t(`전화 : ${org.tel}`,{size:18,font:"맑은 고딕"}),t(`  /  팩스 : ${org.fax}`,{size:18,font:"맑은 고딕"})],{spacing:{after:40}}),
          p([t(`이메일 : ${org.email}`,{size:18,font:"맑은 고딕"}),t(`  /  홈페이지 : ${org.web}`,{size:18,font:"맑은 고딕"})],{spacing:{after:80}}),
        ],
      })]})],
    });

    const wordDoc = new Document({
      sections:[{
        properties:{ page:{ margin:{ top:1000, bottom:1000, left:1200, right:1200 } } },
        children:[
          // 기관명
          p(t(org.name,{bold:true,size:52,color:"1e3a5f",font:"맑은 고딕"}),{alignment:AlignmentType.CENTER,spacing:{after:100}}),
          new Paragraph({border:{bottom:{style:BorderStyle.SINGLE,size:12,color:"1e3a5f"}},children:[],spacing:{after:400}}),
          // 공문 내용
          contentTable,
          // 날짜 + 기관
          emptyP(), emptyP(),
          p(t(docDate,{size:24,font:"맑은 고딕"}),{alignment:AlignmentType.CENTER,spacing:{after:120}}),
          p(t(`${org.name} 소장  ${doc.author_name}`,{bold:true,size:26,font:"맑은 고딕"}),{alignment:AlignmentType.CENTER,spacing:{after:400}}),
          // 시행 정보
          footerTable,
        ],
      }],
    });

    const blob = await Packer.toBlob(wordDoc);
    saveAs(blob, `${doc.id}_공문서.docx`);
    return;
  }

  // ── 일반 문서 양식 (지출결의서, 휴가신청서 등) ───────────────
  const mkRow2 = (label, value) => new TableRow({ children:[
    new TableCell({
      children:[p(t(label,{bold:true,size:20,font:"맑은 고딕"}))],
      shading:{type:ShadingType.CLEAR,fill:"EFF6FF"},
      width:{size:2000,type:WidthType.DXA},
      borders:BD,
    }),
    new TableCell({
      children:[p(t(value,{size:22,font:"맑은 고딕"}))],
      width:{size:7000,type:WidthType.DXA},
      borders:BD,
    }),
  ]});

  const contentTable2 = new Table({
    width:{size:9000, type:WidthType.DXA},
    rows: fields.map(f => mkRow2(
      f.label,
      f.key==="amount" ? Number(doc.fields[f.key]||0).toLocaleString("ko-KR")+"원" : (doc.fields[f.key]||"-")
    )),
  });

  // 결재판 표
  const TEAL = "1e3a5f";
  const stamps = ROLES.map(role => {
    const idx = (doc.approval_line||[]).findIndex(u => u.title === role);
    if (idx < 0) return { role, name:"", date:"" };
    const st = (doc.approval_status||[])[idx];
    return { role, name:doc.approval_line[idx].name, date:st?.date ? new Date(st.date).toLocaleDateString("ko-KR",{month:"2-digit",day:"2-digit"}) : "" };
  });

  const stampTable = new Table({
    width:{size:9000, type:WidthType.DXA},
    rows:[
      new TableRow({ children:stamps.map(s => new TableCell({
        children:[p(t(s.role,{bold:true,color:"FFFFFF",size:18,font:"맑은 고딕"}),{alignment:AlignmentType.CENTER})],
        shading:{type:ShadingType.CLEAR,fill:TEAL},
        width:{size:1500,type:WidthType.DXA},
        borders:BD,
      }))}),
      new TableRow({ children:stamps.map(s => new TableCell({
        children:[
          p(t(s.name||"",{bold:!!s.name,size:20,font:"맑은 고딕"}),{alignment:AlignmentType.CENTER,spacing:{before:60}}),
          p(t(s.date||(s.name?"미결재":""),{size:16,color:s.date?"333333":"AAAAAA",font:"맑은 고딕"}),{alignment:AlignmentType.CENTER,spacing:{after:60}}),
        ],
        width:{size:1500,type:WidthType.DXA},
        borders:BD,
      }))}),
    ],
  });

  const docDate2 = new Date(doc.created_at).toLocaleDateString("ko-KR",{year:"numeric",month:"long",day:"numeric"});

  const wordDoc2 = new Document({
    sections:[{
      properties:{ page:{ margin:{ top:1000, bottom:1000, left:1200, right:1200 } } },
      children:[
        // 제목
        p(t(doc.type,{bold:true,size:40,color:TEAL,font:"맑은 고딕"}),{alignment:AlignmentType.CENTER,spacing:{after:100}}),
        new Paragraph({border:{bottom:{style:BorderStyle.SINGLE,size:8,color:TEAL}},children:[],spacing:{after:300}}),
        // 결재판
        p(t("결    재",{bold:true,size:22,color:TEAL,font:"맑은 고딕"}),{spacing:{before:100,after:120}}),
        stampTable,
        // 내용
        p(t("내    용",{bold:true,size:22,color:TEAL,font:"맑은 고딕"}),{spacing:{before:300,after:120}}),
        contentTable2,
        // 기안 정보
        emptyP(),
        p(t(`문서번호: ${doc.id}  |  기안일: ${docDate2}  |  기안자: ${doc.author_name} (${doc.author_dept} · ${doc.author_title})`,{size:18,color:"666666",font:"맑은 고딕"}),{alignment:AlignmentType.CENTER,spacing:{before:300}}),
      ],
    }],
  });

  const blob2 = await Packer.toBlob(wordDoc2);
  saveAs(blob2, `${doc.id}_${doc.type}.docx`);
}

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

  const ROLES = ["직원", "대리", "과장", "팀장", "실장", "관장"];
  const stampCells = ROLES.map(role => {
    const idx = (doc.approval_line||[]).findIndex(u => u.title === role || u.title.includes(role));
    if (idx < 0) return `<td style="border:1px solid #374151;text-align:center;padding:8px 4px;min-width:60px"><div style="font-weight:700;font-size:11px;background:#1e3a5f;color:#fff;padding:3px;margin:-8px -4px 6px">${role}</div><div style="color:#e5e7eb;font-size:11px">-</div></td>`;
    const st = (doc.approval_status||[])[idx];
    const name = doc.approval_line[idx].name;
    const date = st?.date ? new Date(st.date).toLocaleDateString("ko-KR",{month:"2-digit",day:"2-digit"}).replace(". ","/").replace(".","") : "";
    const bg = st?.status==="승인"?"#f0fdf4":st?.status==="반려"?"#fef2f2":"#fff";
    return `<td style="border:1px solid #374151;text-align:center;padding:0;min-width:60px;background:${bg}"><div style="font-weight:700;font-size:11px;background:#1e3a5f;color:#fff;padding:3px">${role}</div><div style="padding:6px 4px"><div style="font-weight:700;font-size:12px">${name}</div>${date?`<div style="font-size:10px;color:#666;margin-top:2px">${date}</div>`:""}</div></td>`;
  }).join("");

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
    .stamp-table { border-collapse: collapse; margin-bottom: 20px; }
    @media print { button { display: none; } }
  </style></head><body>
  <h1>📋 ${doc.title}</h1>
  <div class="meta">
    문서번호: <strong>${doc.id}</strong> &nbsp;|&nbsp;
    기안일: <strong>${new Date(doc.created_at).toLocaleDateString("ko-KR")}</strong> &nbsp;|&nbsp;
    기안자: <strong>${doc.author_name}</strong> (${doc.author_dept} · ${doc.author_title}) &nbsp;|&nbsp;
    상태: <span class="badge">${doc.status}</span>
  </div>
  <h2>🔖 결재판</h2><table class="stamp-table"><tr>${stampCells}</tr></table>
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
  const headers = ["문서번호", "종류", "제목", "기안자", "부서", "직함", "상태", "기안일", "결재라인", "최종처리일"];
  const dataRows = docs.map(d => {
    const line = (d.approval_line || []).map((u, i) => {
      const st = d.approval_status?.[i];
      return u.name + "(" + (st?.status || "대기중") + ")";
    }).join(" -> ");
    const lastDate = [...(d.history || [])].reverse().find(h => h.action !== "기안 제출")?.date || "";
    return [
      d.id, d.type, d.title, d.author_name, d.author_dept, d.author_title,
      d.status,
      d.created_at ? new Date(d.created_at).toLocaleDateString("ko-KR") : "",
      line,
      lastDate ? new Date(lastDate).toLocaleDateString("ko-KR") : ""
    ];
  });

  const escape = (v) => {
    const s = String(v || "").replace(/,/g, " ").replace(/\n/g, " ");
    return s;
  };
  const csvRows = [headers, ...dataRows].map(r => r.map(escape).join(","));
  const csv = csvRows.join("\n");
  const bom = "\uFEFF";
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const dateStr = new Date().toLocaleDateString("ko-KR").replace(/\. /g, "-").replace(".", "");
  a.download = "결재문서_" + dateStr + ".csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── 워드 파일 파싱 (mammoth 사용) ──────────────────────────────
async function parseWordFile(file) {
  try {
    const mammoth = await import("https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js");
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value || "";
  } catch (e) {
    // fallback: FileReader
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result || "");
      reader.readAsText(file);
    });
  }
}

async function parseWordToFields(file, docType) {
  // ArrayBuffer로 읽어서 Claude API에 base64로 전달
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  bytes.forEach(b => binary += String.fromCharCode(b));
  const base64 = btoa(binary);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: "워드 문서 내용을 분석해서 JSON으로만 응답하세요. 마크다운 없이 순수 JSON만.",
      messages: [{
        role: "user",
        content: [{
          type: "document",
          source: { type: "base64", media_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", data: base64 }
        }, {
          type: "text",
          text: docType === "공문서"
            ? '이 공문서에서 다음 필드를 추출해서 JSON으로 응답하세요: {"receiver": "수신처", "reference": "참조", "subject": "제목", "body": "본문내용(전체)", "attachments": "붙임 목록"}'
            : `이 문서에서 핵심 내용을 추출해서 JSON으로 응답하세요. 문서 종류: ${docType}`
        }]
      }]
    })
  });
  const data = await res.json();
  const text = data.content?.map(i => i.text || "").join("") || "";
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch { return null; }
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
    <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg,#2a7a8c,#3ba8b8)", flexDirection: "column", gap: 16 }}>
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
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#2a7a8c,#3ba8b8)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "'Noto Sans KR',sans-serif" }}>
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
          <button onClick={handle} disabled={loading} style={{ padding: "13px 0", background: "linear-gradient(135deg,#2a7a8c,#3ba8b8)", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1 }}>
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
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#2a7a8c,#3ba8b8)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "'Noto Sans KR',sans-serif" }}>
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
          <button onClick={save} disabled={!name || !dept || loading} style={{ padding: "13px 0", background: "linear-gradient(135deg,#2a7a8c,#3ba8b8)", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: "pointer", marginTop: 4, opacity: (!name || !dept) ? 0.5 : 1 }}>
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

  const recallDoc = async (docId) => {
    const doc = docs.find(d => d.id === docId);
    if (!doc) return;
    const newStatus = "회수";
    const newApprovalStatus = doc.approval_status.map(a => ({ ...a, status: "대기중", comment: "", date: null }));
    const newHistory = [...doc.history, { action: "회수", user: profile.name, date: today(), note: "기안자 회수" }];
    await supabase.from("documents").update({ status: newStatus, approval_status: newApprovalStatus, history: newHistory }).eq("id", docId);
  };

  const deleteDoc = async (docId) => {
    await supabase.from("documents").delete().eq("id", docId);
  };

  // 열람 권한 체크: 기안자 + 결재라인 + 소장(level5)
  const canViewDoc = (doc) => {
    if (!doc.is_secret) return true;
    if (doc.author_id === profile.id) return true;
    if (profile.level >= 5) return true;
    if ((doc.approval_line || []).some(u => u.id === profile.id)) return true;
    return false;
  };

  const toggleSecret = async (docId, isSecret) => {
    await supabase.from("documents").update({ is_secret: isSecret }).eq("id", docId);
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
    <div style={{ fontFamily: "'Noto Sans KR','Malgun Gothic',sans-serif", minHeight: "100vh", background: "#f0f7f9", display: "flex", flexDirection: "column" }}>
      {/* 헤더 */}
      <header style={{ background: "linear-gradient(135deg,#2a7a8c,#3ba8b8)", color: "#fff", padding: "0 20px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 2px 8px rgba(0,0,0,0.2)", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => setMobileMenu(!mobileMenu)} style={{ background: "none", border: "none", color: "#fff", fontSize: 20, cursor: "pointer", display: "block", padding: "4px 8px" }}>☰</button>
          <span style={{ fontSize: 18, fontWeight: 800 }}>📋 결재시스템</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => setNewDocModal(true)} style={{ padding: "7px 14px", background: "rgba(255,255,255,0.25)", color: "#fff", border: "1px solid rgba(255,255,255,0.4)", borderRadius: 20, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>✏️ 기안</button>
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
            width: "75vw", maxWidth: 280, background: "linear-gradient(180deg,#2a7a8c,#3ba8b8)", color: "#fff", padding: "16px 0",
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
                color: tab === m.key ? "#b2f0f5" : "rgba(255,255,255,0.75)", border: "none", cursor: "pointer",
                textAlign: "left", fontSize: 14, display: "flex", alignItems: "center", gap: 10,
                borderLeft: tab === m.key ? "3px solid #b2f0f5" : "3px solid transparent",
              }}>
                {m.icon} {m.label}
                {m.key === "pending" && stats.pending > 0 && (
                  <span style={{ marginLeft: "auto", background: "#ef4444", color: "#fff", borderRadius: 10, padding: "1px 7px", fontSize: 11, fontWeight: 700 }}>{stats.pending}</span>
                )}
              </button>
            ))}
            <div style={{ margin: "16px 12px 0" }}>
              <button onClick={() => { setNewDocModal(true); setMobileMenu(false); }} style={{ width: "100%", padding: "11px 0", background: "linear-gradient(135deg,#38bdd1,#2a9aaa)", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
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
              {tab === "dashboard" && <Dashboard stats={stats} docs={docs} setSelectedDoc={setSelectedDoc} setTab={setTab} canViewDoc={canViewDoc} />}
              {tab === "myDocs" && <DocList docs={docs.filter(d => d.author_id === profile.id)} title="내 문서함" setSelectedDoc={setSelectedDoc} canViewDoc={canViewDoc} />}
              {tab === "pending" && <PendingList docs={docs} profile={profile} onApprove={approveDoc} setSelectedDoc={setSelectedDoc} canViewDoc={canViewDoc} />}
              {tab === "history" && <DocList docs={docs} title="전체 문서 이력" setSelectedDoc={setSelectedDoc} canViewDoc={canViewDoc} />}
            </>
          )}
        </main>
      </div>

      {/* 모달들 */}
      {selectedDoc && <DocDetailModal doc={selectedDoc} profile={profile} onClose={() => setSelectedDoc(null)} onApprove={approveDoc} onRecall={recallDoc} onDelete={deleteDoc} onToggleSecret={toggleSecret} canView={canViewDoc(selectedDoc)} />}
      {newDocModal && <NewDocModal onClose={() => setNewDocModal(false)} onSubmit={addDoc} profile={profile} allProfiles={profiles} />}
    </div>
  );
}

// ─── 대시보드 ─────────────────────────────────────────────────
function Dashboard({ stats, docs, setSelectedDoc, setTab }) {
  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: "#2a7a8c", marginBottom: 16 }}>📊 대시보드</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "전체 문서", value: stats.total, icon: "📋", color: "#3ba8b8", bg: "#e8f7f9", tab: "history" },
          { label: "결재 대기", value: stats.pending, icon: "⏳", color: "#5b9fd4", bg: "#e8f2fb", tab: "pending" },
          { label: "승인 완료", value: stats.approved, icon: "✅", color: "#4db8a8", bg: "#e6f7f5", tab: "myDocs" },
          { label: "반려", value: stats.rejected, icon: "❌", color: "#7a9ebe", bg: "#edf3f8", tab: "myDocs" },
        ].map(s => (
          <div key={s.label} onClick={() => setTab(s.tab)} style={{ background: s.bg || "#fff", borderRadius: 12, padding: "16px 20px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", borderTop: `4px solid ${s.color}`, cursor: "pointer", transition: "transform 0.1s, box-shadow 0.1s" }}
            onMouseEnter={e => { e.currentTarget.style.transform="translateY(-2px)"; e.currentTarget.style.boxShadow="0 4px 12px rgba(0,0,0,0.12)"; }}
            onMouseLeave={e => { e.currentTarget.style.transform=""; e.currentTarget.style.boxShadow="0 1px 4px rgba(0,0,0,0.06)"; }}>
            <div style={{ fontSize: 22, marginBottom: 4 }}>{s.icon}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>{s.label}</div>
          </div>
        ))}
      </div>
      <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#2a7a8c" }}>최근 문서</h3>
          <button onClick={() => setTab("history")} style={{ fontSize: 12, color: "#3b82f6", background: "none", border: "none", cursor: "pointer" }}>전체보기 →</button>
        </div>
        {docs.slice(0, 5).map(d => <DocRow key={d.id} doc={d} onClick={() => setSelectedDoc(d)} canView={canViewDoc ? canViewDoc(d) : true} />)}
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
        {["전체", "대기중", "진행중", "승인", "반려", "회수"].map(s => (
          <button key={s} onClick={() => setFilter(s)} style={{ padding: "5px 12px", borderRadius: 20, fontSize: 12, border: "none", cursor: "pointer", background: filter === s ? "#3ba8b8" : "#e8f4f7", color: filter === s ? "#fff" : "#4a7a8a", fontWeight: filter === s ? 700 : 400 }}>{s}</button>
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
      <h2 style={{ fontSize: 18, fontWeight: 700, color: "#2a7a8c", marginBottom: 14 }}>⏳ 결재 대기함 ({pending.length})</h2>
      <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        {pending.map((d, i) => (
          <DocRow key={d.id} doc={d} onClick={() => setSelectedDoc(d)} noBorder={i === pending.length - 1} canView={true}
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
function DocRow({ doc, onClick, noBorder, showActions, onAction, canView }) {
  const [comment, setComment] = useState("");
  const [showComment, setShowComment] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const meta = STATUS_META[doc.status] || STATUS_META["대기중"];
  const isSecret = !!doc.is_secret;
  const viewable = canView !== false;

  const handleAction = (action) => {
    if (!showComment) { setPendingAction(action); setShowComment(true); return; }
    onAction(pendingAction, comment);
    setShowComment(false); setComment(""); setPendingAction(null);
  };

  const handleClick = () => {
    if (!viewable) { alert("열람 권한이 없는 비밀문서입니다."); return; }
    onClick();
  };

  return (
    <div style={{ borderBottom: noBorder ? "none" : "1px solid #f3f4f6" }}>
      <div onClick={handleClick} style={{ display: "flex", alignItems: "center", padding: "13px 16px", cursor: viewable ? "pointer" : "not-allowed", gap: 10, opacity: viewable ? 1 : 0.6 }}
        onMouseEnter={e => { if(viewable) e.currentTarget.style.background = "#f9fafb"; }}
        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
        <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 20, background: meta.bg, color: meta.color, fontWeight: 700, whiteSpace: "nowrap" }}>
          {meta.icon} {doc.status}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {isSecret && <span style={{ fontSize: 11, background: "#fee2e2", color: "#dc2626", borderRadius: 4, padding: "1px 5px", marginRight: 5, fontWeight: 700 }}>🔒 비밀</span>}
            {viewable ? doc.title : doc.title.replace(/\[.*?\]\s*/, "[비밀문서] ●●●")}
          </div>
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
function DocDetailModal({ doc, profile, onClose, onApprove, onRecall, onDelete, onToggleSecret, canView }) {
  const [commentMap, setCommentMap] = useState({});
  const [showOrgModal, setShowOrgModal] = useState(false);
  const meta = STATUS_META[doc.status] || STATUS_META["대기중"];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 1000 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      {showOrgModal && <OrgSelectModal doc={doc} onClose={() => setShowOrgModal(false)} />}
      <div style={{ background: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 720, maxHeight: "92vh", overflow: "auto", boxShadow: "0 -8px 40px rgba(0,0,0,0.2)" }}>
        {/* 핸들 */}
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 0" }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: "#e5e7eb" }} />
        </div>
        {/* 헤더 */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1e3a5f" }}>
              {doc.is_secret && <span style={{ fontSize: 12, background: "#fee2e2", color: "#dc2626", borderRadius: 4, padding: "1px 6px", marginRight: 6, fontWeight: 700 }}>🔒 비밀</span>}
              {doc.title}
            </div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 3 }}>문서번호: {doc.id} · {fmtDate(doc.created_at)}</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <span style={{ padding: "4px 12px", borderRadius: 20, background: meta.bg, color: meta.color, fontWeight: 700, fontSize: 12 }}>{meta.icon} {doc.status}</span>
            {doc.author_id === profile.id && (
              <button onClick={() => onToggleSecret(doc.id, !doc.is_secret)} style={{ padding: "5px 10px", background: doc.is_secret ? "#fee2e2" : "#f3f4f6", color: doc.is_secret ? "#dc2626" : "#6b7280", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                {doc.is_secret ? "🔒 비밀해제" : "🔓 비밀설정"}
              </button>
            )}
            {doc.author_id === profile.id && doc.status !== "승인" && doc.status !== "회수" && (
              <button onClick={() => {
                if (window.confirm("기안을 회수하시겠어요?\n진행 중인 결재가 초기화됩니다.")) { onRecall(doc.id); onClose(); }
              }} style={{ padding: "5px 10px", background: "#5b9fd4", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>↩️ 회수</button>
            )}
            {doc.author_id === profile.id && (doc.status === "회수" || doc.status === "반려") && (
              <button onClick={() => {
                if (window.confirm("이 문서를 삭제하시겠어요?\n삭제 후 복구할 수 없습니다.")) { onDelete(doc.id); onClose(); }
              }} style={{ padding: "5px 10px", background: "#7a9ebe", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>🗑️ 삭제</button>
            )}
            <button onClick={() => { if (doc.type === "공문서") setShowOrgModal(true); else if (doc.type === "지출결의서") exportExpenseToWord(doc); else exportDocToWord(doc, "묘한 LAB"); }} style={{ padding: "5px 10px", background: "#4db8a8", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>📄 워드</button>
            <button onClick={() => printDoc(doc)} style={{ padding: "5px 10px", background: "#2a7a8c", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>🖨️ PDF</button>
            <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: "50%", background: "#e5e7eb", border: "none", cursor: "pointer", fontSize: 16 }}>×</button>
          </div>
        </div>

        {!canView ? (
          <div style={{ padding: 40, textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#dc2626", marginBottom: 8 }}>비밀문서</div>
            <div style={{ fontSize: 14, color: "#6b7280" }}>열람 권한이 없는 문서입니다.</div>
          </div>
        ) : (
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

          {/* 결재판 */}
          <ApprovalStamp doc={doc} />

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

          {/* 첨부파일 */}
          {doc.attachments && doc.attachments.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 10 }}>📎 첨부파일</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {doc.attachments.map((f, i) => (
                  <a key={i} href={f.url} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 8, background: "#f0f7f9", borderRadius: 8, padding: "8px 12px", textDecoration: "none", border: "1px solid #b0d8e0" }}>
                    <span style={{ fontSize: 16 }}>📄</span>
                    <span style={{ fontSize: 13, color: "#2a7a8c", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                    <span style={{ fontSize: 11, color: "#9ca3af" }}>{(f.size/1024).toFixed(0)}KB</span>
                  </a>
                ))}
              </div>
            </div>
          )}
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
        )}
      </div>
    </div>
  );
}

// ─── 결재판 컴포넌트 ─────────────────────────────────────────
function ApprovalStamp({ doc }) {
  const ROLES = ["직원", "대리", "과장", "팀장", "실장", "관장"];
  const line = doc.approval_line || [];
  const status = doc.approval_status || [];

  // 결재라인을 ROLES 순서에 맞게 매핑
  const stamps = ROLES.map(role => {
    const idx = line.findIndex(u => u.title === role || u.title.includes(role));
    if (idx < 0) {
      // 결재라인에 없는 직급은 빈칸
      return { role, name: "", date: "", status: "없음" };
    }
    const st = status[idx];
    return {
      role,
      name: line[idx].name,
      date: st?.date ? new Date(st.date).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" }).replace(". ", "/").replace(".", "") : "",
      status: st?.status || "대기중",
    };
  });

  return (
    <div style={{ marginBottom: 16 }}>
      <h3 style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 10 }}>🔖 결재판</h3>
      <div style={{ display: "flex", border: "1.5px solid #374151", borderRadius: 4, overflow: "hidden", fontSize: 12 }}>
        {stamps.map((s, i) => (
          <div key={i} style={{
            flex: 1, borderRight: i < stamps.length - 1 ? "1px solid #374151" : "none",
            display: "flex", flexDirection: "column", minWidth: 0,
          }}>
            {/* 직급 */}
            <div style={{ background: "linear-gradient(135deg,#2a7a8c,#3ba8b8)", color: "#fff", textAlign: "center", padding: "4px 2px", fontSize: 11, fontWeight: 700 }}>{s.role}</div>
            {/* 이름 + 날짜 영역 */}
            <div style={{
              minHeight: 52, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              padding: "6px 2px", background: s.status === "승인" ? "#f0fdf4" : s.status === "반려" ? "#fef2f2" : "#fff",
              position: "relative",
            }}>
              {s.name ? (
                <>
                  {s.status === "승인" && (
                    <div style={{ position: "absolute", top: 2, right: 3, fontSize: 9, color: "#059669", fontWeight: 700 }}>✓</div>
                  )}
                  {s.status === "반려" && (
                    <div style={{ position: "absolute", top: 2, right: 3, fontSize: 9, color: "#dc2626", fontWeight: 700 }}>✗</div>
                  )}
                  <div style={{ fontWeight: 700, fontSize: 12, textAlign: "center", color: "#111" }}>{s.name}</div>
                  {s.date && <div style={{ fontSize: 10, color: "#6b7280", marginTop: 3 }}>{s.date}</div>}
                  {!s.date && s.status === "대기중" && <div style={{ fontSize: 10, color: "#d1d5db", marginTop: 3 }}>미결재</div>}
                </>
              ) : (
                <div style={{ fontSize: 10, color: "#e5e7eb" }}>-</div>
              )}
            </div>
          </div>
        ))}
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
  const [wordLoading, setWordLoading] = useState(false);
  const [attachments, setAttachments] = useState([]); // { name, url, size }
  const [uploading, setUploading] = useState(false);

  const setField = (k, v) => setFields(p => ({ ...p, [k]: v }));

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    // input 초기화 (같은 파일 재업로드 가능하게)
    e.target.value = "";
    setUploading(true);
    const uploaded = [];
    try {
      for (const file of files) {
        try {
          const ext = file.name.split(".").pop();
          const path = "attachments/" + Date.now() + "_" + Math.random().toString(36).slice(2) + "." + ext;
          const { error } = await supabase.storage.from("documents").upload(path, file);
          if (!error) {
            const { data } = supabase.storage.from("documents").getPublicUrl(path);
            uploaded.push({ name: file.name, url: data.publicUrl, size: file.size });
          } else {
            uploaded.push({ name: file.name, url: "", size: file.size, local: true });
          }
        } catch {
          uploaded.push({ name: file.name, url: "", size: file.size, local: true });
        }
      }
      setAttachments(prev => [...prev, ...uploaded]);
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = (idx) => setAttachments(prev => prev.filter((_, i) => i !== idx));

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
      title: `[${docType}] ${titleMap[docType] || "문서"}`,
      author_id: profile.id, author_name: profile.name,
      author_dept: profile.dept, author_title: profile.title,
      status: "대기중",
      approval_line: approvalLine,
      approval_status: approvalLine.map(() => ({ status: "대기중", comment: "", date: null })),
      fields, attachments,
      history: [{ action: "기안 제출", user: profile.name, date: today(), note: "" }],
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                {Object.keys(TEMPLATES).map(t => (
                  <button key={t} onClick={() => { setDocType(t); setFields({}); setWordLoading(false); }} style={{ padding: 14, border: `2px solid ${docType === t ? "#3b82f6" : "#e5e7eb"}`, borderRadius: 10, background: docType === t ? "#eff6ff" : "#fff", cursor: "pointer", textAlign: "left" }}>
                    <div style={{ fontSize: 22, marginBottom: 4 }}>{({ 지출결의서: "💰", 휴가신청서: "🏖️", 업무보고서: "📊", 자유양식: "📝", 공문서: "📮" })[t]}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: docType === t ? "#3b82f6" : "#111827" }}>{t}</div>
                  </button>
                ))}
              </div>
              {/* 워드 파일 업로드 */}
              <div style={{ background: "#f0fdf4", border: "2px dashed #86efac", borderRadius: 10, padding: 14, marginBottom: 14, textAlign: "center" }}>
                <div style={{ fontSize: 13, color: "#059669", fontWeight: 700, marginBottom: 8 }}>📄 워드 파일로 자동 작성</div>
                <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>.docx 파일을 올리면 내용을 자동으로 채워드려요!</div>
                <label style={{ display: "inline-block", padding: "8px 16px", background: "#059669", color: "#fff", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                  {wordLoading ? "⏳ 분석 중..." : "📂 파일 선택"}
                  <input type="file" accept=".docx" style={{ display: "none" }} onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setWordLoading(true);
                    const result = await parseWordToFields(file, docType);
                    if (result) { setFields(result); setStep(2); }
                    else alert("파일 분석에 실패했어요. 다시 시도해주세요.");
                    setWordLoading(false);
                  }} />
                </label>
              </div>
              <button onClick={() => setStep(2)} style={{ width: "100%", padding: 12, background: "#3b82f6", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>직접 입력 →</button>
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
              {/* 첨부파일 업로드 */}
              <div style={{ marginTop: 14, background: "#e8f7f9", borderRadius: 10, padding: 14, border: "2px dashed #3ba8b8" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#2a7a8c" }}>📎 첨부파일</div>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "#2a7a8c", color: "#fff", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                    {uploading ? "⏳ 업로드 중..." : "＋ 파일 추가"}
                    <input type="file" multiple style={{ display: "none" }} onChange={handleFileUpload} />
                  </label>
                </div>
                <div style={{ fontSize: 12, color: "#5b9fd4", marginBottom: 6 }}>모든 파일 형식 가능 (이미지, PDF, 엑셀, 워드 등)</div>
                {attachments.length === 0 && (
                  <div style={{ textAlign: "center", padding: "10px 0", color: "#9ca3af", fontSize: 12 }}>첨부파일이 없어요</div>
                )}
                {attachments.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                    {attachments.map((f, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff", borderRadius: 6, padding: "7px 10px", border: "1px solid #b0d8e0" }}>
                        <span style={{ fontSize: 16 }}>📄</span>
                        <span style={{ fontSize: 12, color: "#2a7a8c", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                        <span style={{ fontSize: 11, color: "#9ca3af", flexShrink: 0 }}>{(f.size/1024).toFixed(0)}KB</span>
                        <button onClick={() => removeAttachment(i)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 16, padding: 0, flexShrink: 0 }}>×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <button onClick={() => setStep(1)} style={{ flex: 1, padding: 12, background: "#e5e7eb", color: "#374151", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer" }}>← 이전</button>
                <button onClick={() => setStep(3)} style={{ flex: 2, padding: 12, background: "#3ba8b8", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer" }}>다음 →</button>
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
                      {p.title === "소장" && <span style={{ marginLeft: "auto", fontSize: 11, padding: "2px 8px", background: "#d6f0f4", color: "#2a8a9c", borderRadius: 20, fontWeight: 700 }}>소장</span>}
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
