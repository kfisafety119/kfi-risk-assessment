import React, { useState, useRef, useCallback } from "react";
import * as mammoth from "mammoth";

const CATS = ["기계적", "인적", "물질·환경적", "관리적"];
const riskBg = s => s >= 6 ? "#ef4444" : s >= 3 ? "#f59e0b" : "#22c55e";
const SAUSAGES = ["설치, 이전, 변경","신규","정비, 보수","산업재해","기타"];
const IMG_TYPES = ["jpg","jpeg","png","gif","webp","bmp"];

// ── Claude API 프록시 (Vercel Serverless Function) ──
const CLAUDE_API = "/api/claude";

// ── Google Forms 사용 이력 기록 ──
const FORM_ID = "1FAIpQLSequrKF9D3647fpyhWSAsxcaYDnr3kNlD0zigDgsKvHeRlDlQ";
const FORM_URL = `https://docs.google.com/forms/d/e/${FORM_ID}/formResponse`;
const FORM_FIELDS = {
  작성자: "entry.2007345870",
  소속: "entry.480345722",
  평가일자: "entry.1754134417",
  작업명: "entry.641793519",
  작성사유: "entry.239963430",
  추가정보: "entry.407623786",
  첨부파일수: "entry.86264424",
  기계적_위험도: "entry.1022056348",
  인적_위험도: "entry.1817082199",
  물질환경_위험도: "entry.666005861",
  관리적_위험도: "entry.20724192"
};

// ── EmailJS 설정 (배포 후 채워넣기) ──
const EMAILJS_PUBLIC_KEY = "YOUR_PUBLIC_KEY";
const EMAILJS_SERVICE_ID = "YOUR_SERVICE_ID";
const EMAILJS_TEMPLATE_ID = "YOUR_TEMPLATE_ID";
const ADMIN_EMAIL = "kfisafety119@gmail.com";

function fmtDate(s){if(!s)return"";const d=new Date(s);return isNaN(d)?s:`${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일`;}
function toBase64(f){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(f);});}

async function callClaude(messages, maxTokens = 1000) {
  const res = await fetch(CLAUDE_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      messages
    })
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errText}`);
  }
  return await res.json();
}

async function logToGoogleForm(form, 항목, fileCount, saveType) {
  try {
    const getRisk = cat => {
      const it = 항목.find(x=>x.구분===cat);
      if(!it) return "";
      const b = it.개선전||{};
      return String((b.빈도||1)*(b.강도||1));
    };
    const data = {
      작성자: form.작성자||"",
      소속: form.소속||"",
      평가일자: form.평가일자||"",
      작업명: form.작업명||"",
      작성사유: form.작성사유+(form.작성사유==="기타"&&form.기타사유?`(${form.기타사유})`:""),
      추가정보: (form.추가정보||"").slice(0,500),
      첨부파일수: String(fileCount||0),
      기계적_위험도: getRisk("기계적"),
      인적_위험도: getRisk("인적"),
      물질환경_위험도: getRisk("물질·환경적"),
      관리적_위험도: getRisk("관리적")
    };
    const params = new URLSearchParams();
    Object.entries(data).forEach(([key,val])=>{
      const entryId=FORM_FIELDS[key];
      if(entryId) params.append(entryId,val);
    });
    params.append("submit","Submit");
    await fetch(`${FORM_URL}?${params.toString()}`,{method:"POST",mode:"no-cors"});
    console.log("[GoogleForm] ✅ 전송 완료",{...data,저장형식:saveType});
    return true;
  } catch(e){
    console.error("[GoogleForm] 실패:",e);
    return false;
  }
}

async function sendEmailToAdmin(form, 항목, saveType) {
  if(EMAILJS_PUBLIC_KEY==="YOUR_PUBLIC_KEY") {
    console.log("[Email] EmailJS 설정 안 됨 - 건너뛰기");
    return false;
  }
  try {
    const summary = 항목.map(item=>{
      const b=item.개선전||{};
      const bS=(b.빈도||1)*(b.강도||1);
      return `▣ ${item.구분} (위험도: ${bS})\n  · 위험요인: ${item.주요위험요인}\n  · 안전조치: ${item.현재안전조치}\n  · 개선대책: ${item.개선대책}`;
    }).join("\n\n");

    await fetch("https://api.emailjs.com/api/v1.0/email/send",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        service_id: EMAILJS_SERVICE_ID,
        template_id: EMAILJS_TEMPLATE_ID,
        user_id: EMAILJS_PUBLIC_KEY,
        template_params:{
          to_email: ADMIN_EMAIL,
          작성자: form.작성자,
          소속: form.소속,
          작업명: form.작업명,
          평가일자: form.평가일자,
          작성사유: form.작성사유,
          저장형식: saveType,
          저장시각: new Date().toLocaleString("ko-KR"),
          요약: summary
        }
      })
    });
    console.log("[Email] ✅ 관리자 메일 발송 완료");
    return true;
  } catch(e){
    console.error("[Email] 실패:",e);
    return false;
  }
}

async function processFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  try {
    if (IMG_TYPES.includes(ext)) {
      const b64 = await toBase64(file);
      const mime = ext==="jpg"||ext==="jpeg"?"image/jpeg":ext==="png"?"image/png":ext==="gif"?"image/gif":ext==="webp"?"image/webp":"image/png";
      return {name:file.name, type:"image", data:b64, mime};
    } else if (ext==="pdf") {
      const b64 = await toBase64(file);
      return {name:file.name, type:"pdf", data:b64};
    } else if (ext==="docx") {
      const ab = await file.arrayBuffer();
      const {value} = await mammoth.extractRawText({arrayBuffer:ab});
      return {name:file.name, type:"text", content:value};
    } else if (ext==="txt") {
      return {name:file.name, type:"text", content:await file.text()};
    } else if (ext==="hwp") {
      return {name:file.name, type:"hwp", content:""};
    }
    return {name:file.name, type:"unknown", content:""};
  } catch(e) {
    return {name:file.name, type:"error", content:""};
  }
}

function buildContent(prompt, files) {
  const pdfs = files.filter(f=>f.type==="pdf");
  const imgs = files.filter(f=>f.type==="image");
  const texts = files.filter(f=>f.type==="text"&&f.content);
  let fullPrompt = prompt;
  if (texts.length) fullPrompt += "\n\n[첨부문서]\n" + texts.map(f=>`≪${f.name}≫\n${f.content.slice(0,3000)}`).join("\n\n");
  if (!pdfs.length && !imgs.length) return fullPrompt;
  const arr = [];
  pdfs.forEach(f=>arr.push({type:"document",source:{type:"base64",media_type:"application/pdf",data:f.data}}));
  imgs.forEach(f=>arr.push({type:"image",source:{type:"base64",media_type:f.mime,data:f.data}}));
  arr.push({type:"text",text:fullPrompt});
  return arr;
}

async function fetchOne(구분, jobInfo, files) {
  const prompt=`산업안전보건법 위험성평가 전문가입니다. 아래 작업의 [${구분}] 위험요인에 대한 수시 위험성평가를 작성하세요.
작업명: ${jobInfo.작업명} / 소속: ${jobInfo.소속} / 작성사유: ${jobInfo.작성사유}
추가설명: ${jobInfo.추가정보||"없음"}
## 기준
- 빈도: 상=3(월1회이상) 중=2(연1회) 하=1(3년이하) / 강도: 대=3 중=2 소=1 / 위험도=빈도×강도
- 해당 없으면: 주요위험요인="해당 없음", 나머지="-", 빈도=1 강도=1
- 위험도 1~2: 개선대책="-", 개선후=개선전 동일 / 위험도 3+: 구체적 개선대책 작성
- 첨부파일이 있으면 내용을 참고하여 더 정확한 위험요인 도출
- 실제 특성에 맞게 점수 판단, 억지로 높은 점수 금지
## 출력: JSON 객체만 (백틱·설명 금지, 문자열 내 큰따옴표→작은따옴표)
{"구분":"${구분}","주요위험요인":"...","현재안전조치":"...","개선대책":"...","개선전":{"빈도":2,"강도":2},"개선후":{"빈도":1,"강도":1}}`;
  const content = buildContent(prompt, files);
  const data = await callClaude([{role:"user",content}], 1000);
  const raw = data.content?.map(b=>b.text||"").join("")||"";
  const s=raw.indexOf("{"),e=raw.lastIndexOf("}");
  if(s===-1||e===-1)throw new Error(`[${구분}] JSON 없음`);
  let parsed;
  try{parsed=JSON.parse(raw.slice(s,e+1));}
  catch{parsed=JSON.parse(raw.slice(s,e+1).replace(/[\u0000-\u001F\u007F]/g," ").replace(/\n|\r/g,""));}
  parsed.구분=구분;return parsed;
}

function exportWord(result, mode = "download") {
  const fd = result.formData;
  const 사유str = SAUSAGES.map(s=>`${fd.작성사유===s?"■":"□"} ${s}${s==="기타"&&fd.기타사유?`(${fd.기타사유})`:""}`).join("&nbsp;&nbsp;&nbsp;");
  const rows = result.항목.map(item=>{
    const b=item.개선전||{},a=item.개선후||{};
    const bF=b.빈도||1,bI=b.강도||1,bS=bF*bI;
    const lowRisk=bS<=2;
    const aF=lowRisk?"-":(a.빈도||1);
    const aI=lowRisk?"-":(a.강도||1);
    const aS=lowRisk?"-":(a.빈도||1)*(a.강도||1);
    const 개선대책=lowRisk?"-":(item.개선대책||"");
    const bCol=bS>=6?"#FECACA":bS>=3?"#FDE68A":"#BBF7D0";
    const aCol=lowRisk?"#f5f5f5":(aS>=6?"#FECACA":aS>=3?"#FDE68A":"#BBF7D0");
    const aTextColor=lowRisk?"#999":"#000";
    return `
      <tr>
        <td rowspan="2" style="border:1px solid #555;padding:4px 3px;text-align:center;font-weight:bold;background:#dce3ee;vertical-align:middle;font-size:8pt;">${item.구분}</td>
        <td colspan="4" style="border:1px solid #555;padding:4px 3px;vertical-align:top;font-size:7.5pt;line-height:1.5;">${(item.주요위험요인||"").replace(/\n/g,"<br>")}</td>
        <td rowspan="2" style="border:1px solid #555;padding:4px 3px;vertical-align:top;font-size:7.5pt;line-height:1.5;">${(item.현재안전조치||"").replace(/\n/g,"<br>")}</td>
        <td colspan="4" style="border:1px solid #555;padding:4px 3px;vertical-align:top;font-size:7.5pt;line-height:1.5;text-align:${lowRisk?"center":"left"};color:${aTextColor};">${개선대책.replace(/\n/g,"<br>")}</td>
        <td rowspan="2" style="border:1px solid #555;padding:3px;"></td>
        <td rowspan="2" style="border:1px solid #555;padding:3px;"></td>
        <td rowspan="2" style="border:1px solid #555;padding:0;text-align:center;font-size:7.5pt;vertical-align:middle;">
          <div style="padding:5px 2px;border-bottom:1px solid #555;">□ 적정</div>
          <div style="padding:5px 2px;">□ 보완</div>
        </td>
        <td rowspan="2" style="border:1px solid #555;padding:3px;"></td>
      </tr>
      <tr>
        <td style="border:1px solid #555;padding:3px;background:#e8eaf0;text-align:center;font-size:7pt;font-weight:bold;">개선전</td>
        <td style="border:1px solid #555;padding:3px;text-align:center;font-size:8pt;">${bF}</td>
        <td style="border:1px solid #555;padding:3px;text-align:center;font-size:8pt;">${bI}</td>
        <td style="border:1px solid #555;padding:3px;text-align:center;background:${bCol};font-weight:bold;font-size:8pt;">${bS}</td>
        <td style="border:1px solid #555;padding:3px;background:#e8eaf0;text-align:center;font-size:7pt;font-weight:bold;">개선후</td>
        <td style="border:1px solid #555;padding:3px;text-align:center;font-size:8pt;color:${aTextColor};">${aF}</td>
        <td style="border:1px solid #555;padding:3px;text-align:center;font-size:8pt;color:${aTextColor};">${aI}</td>
        <td style="border:1px solid #555;padding:3px;text-align:center;background:${aCol};font-weight:bold;font-size:8pt;color:${aTextColor};">${aS}</td>
      </tr>
      <tr><td colspan="14" style="height:3px;background:#f5f5f5;border:1px solid #ddd;"></td></tr>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="UTF-8">
<xml><w:WordDocument><w:View>Normal</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml>
<style>
  @page WordSection1 {size:297mm 210mm;margin:10mm;mso-page-orientation:landscape;}
  div.WordSection1{page:WordSection1;}
  body{font-family:'맑은 고딕','Malgun Gothic',sans-serif;font-size:8.5pt;margin:0;padding:0;}
  table{border-collapse:collapse;width:100%;table-layout:fixed;}
  td,th{font-size:8pt;font-family:'맑은 고딕','Malgun Gothic',sans-serif;word-break:break-all;overflow-wrap:break-word;}
  h1{text-align:center;font-size:14pt;letter-spacing:6px;margin:4px 0 4px;}
  .info-label{background:#d0d7e3;font-weight:bold;text-align:center;padding:3px 4px;border:1px solid #555;font-size:8pt;white-space:nowrap;}
  .info-val{padding:3px 5px;border:1px solid #555;font-size:8pt;}
  .col-hdr{background:#d0d7e3;font-weight:bold;text-align:center;padding:3px 2px;border:1px solid #555;font-size:8pt;}
</style></head><body><div class="WordSection1">
<table style="margin-bottom:3px;border-collapse:collapse;width:100%;">
  <tr>
    <td style="width:75%;"><h1>수시 위험성평가표</h1></td>
    <td style="width:25%;vertical-align:top;text-align:right;">
      <table style="border-collapse:collapse;display:inline-table;table-layout:fixed;">
        <tr>
          <td style="border:1px solid #555;padding:2px 0;background:#d0d7e3;text-align:center;font-weight:bold;font-size:8pt;width:60px;">작&nbsp;성</td>
          <td style="border:1px solid #555;padding:2px 0;background:#d0d7e3;text-align:center;font-weight:bold;font-size:8pt;width:60px;">승&nbsp;인</td>
        </tr>
        <tr><td style="border:1px solid #555;height:36px;width:60px;"></td><td style="border:1px solid #555;height:36px;width:60px;"></td></tr>
      </table>
    </td>
  </tr>
</table>
<table style="margin-bottom:2px;">
  <colgroup><col style="width:8%"><col style="width:38%"><col style="width:8%"><col></colgroup>
  <tr><td class="info-label">소&nbsp;&nbsp;&nbsp;속</td><td class="info-val">${fd.소속||""}</td><td class="info-label">작&nbsp;성&nbsp;자</td><td class="info-val">${fd.작성자||""}</td></tr>
  <tr><td class="info-label">작업(업무)명</td><td class="info-val" colspan="3"><b>${fd.작업명||""}</b></td></tr>
  <tr><td class="info-label">평&nbsp;가&nbsp;일&nbsp;자</td><td class="info-val" colspan="3">${fmtDate(fd.평가일자)}</td></tr>
  <tr><td class="info-label">작&nbsp;성&nbsp;사&nbsp;유</td><td class="info-val" colspan="3" style="font-size:7.5pt;">${사유str}</td></tr>
</table>
<table>
  <colgroup>
    <col style="width:5%"><col style="width:8%"><col style="width:3.5%"><col style="width:3.5%"><col style="width:4%">
    <col style="width:13%"><col style="width:8%"><col style="width:3.5%"><col style="width:3.5%"><col style="width:4%">
    <col style="width:9%"><col style="width:9%"><col style="width:8%"><col style="width:14%">
  </colgroup>
  <tr>
    <th class="col-hdr">구분</th><th class="col-hdr" colspan="4">주요위험요인</th>
    <th class="col-hdr">현재 안전조치</th><th class="col-hdr" colspan="4">개선대책</th>
    <th class="col-hdr" style="white-space:nowrap;">개선예정일</th>
    <th class="col-hdr" style="white-space:nowrap;">완료확인일</th>
    <th class="col-hdr" style="white-space:nowrap;">평가구분</th>
    <th class="col-hdr" style="white-space:nowrap;">담당자(작성자)</th>
  </tr>
  ${rows}
</table>
<p style="font-size:7.5pt;color:#666;margin:3px 0 0;">위험도 = 빈도 × 강도 &nbsp;|&nbsp; 6~9: 높음 &nbsp;|&nbsp; 3~4: 보통 &nbsp;|&nbsp; 1~2: 낮음</p>
<p style="font-size:7.5pt;color:#92400e;background:#fef3c7;padding:4px 6px;margin:3px 0 0;">⚠️ AI 작성 내용 검토 후 공란(개선예정일·완료확인일·담당자 서명)을 자필로 기재하여 정식 문서로 활용하세요.</p>
</div></body></html>`;

  if (mode === "print") {
    const w = window.open("", "_blank");
    if (!w) { alert("팝업이 차단되었습니다."); return; }
    w.document.open(); w.document.write(html); w.document.close();
    const doPrint = () => { try { w.focus(); w.print(); } catch(e){} };
    if (w.document.readyState === "complete") doPrint(); else w.onload = doPrint;
    setTimeout(doPrint, 800);
    return;
  }
  const blob = new Blob(["\ufeff"+html],{type:"application/vnd.ms-word;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `수시위험성평가_${fd.작업명||"평가"}_${fd.평가일자||""}.doc`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const FILE_ICON = f => {
  if(f.type==="pdf") return "📕";
  if(f.type==="image") return "🖼️";
  if(f.type==="text") return f.name.endsWith(".docx")?"📝":"📄";
  if(f.type==="hwp") return "📋";
  return "📎";
};
const FILE_DESC = f => {
  if(f.type==="pdf") return "PDF — AI 직접 분석";
  if(f.type==="image") return "이미지 — AI 직접 분석";
  if(f.type==="text") return `텍스트 추출 완료 (${f.content?.length?.toLocaleString()}자)`;
  if(f.type==="hwp") return "HWP — 파일명만 참조";
  return "첨부됨";
};

export default function App() {
  const [step,setStep]=useState("input");
  const [progress,setProgress]=useState({current:0,label:""});
  const [form,setForm]=useState({소속:"안전관리부",작업명:"",평가일자:new Date().toISOString().slice(0,10),작성자:"",작성사유:"설치, 이전, 변경",기타사유:"",추가정보:""});
  const [attachedFiles,setAttachedFiles]=useState([]);
  const [fileLoading,setFileLoading]=useState(false);
  const [dragging,setDragging]=useState(false);
  const [result,setResult]=useState(null);
  const [error,setError]=useState("");
  const [toast,setToast]=useState("");
  const [chatMsgs,setChatMsgs]=useState([]);
  const [chatInput,setChatInput]=useState("");
  const [chatLoading,setChatLoading]=useState(false);
  const fileRef=useRef();

  const showToast=msg=>{setToast(msg);setTimeout(()=>setToast(""),3000);};

  const addFiles = useCallback(async(fileList)=>{
    const files = Array.from(fileList);
    if(!files.length) return;
    setFileLoading(true);
    const processed = await Promise.all(files.map(processFile));
    setAttachedFiles(prev=>[...prev, ...processed.filter(Boolean)]);
    setFileLoading(false);
  },[]);

  const onDrop = useCallback(e=>{
    e.preventDefault();setDragging(false);
    addFiles(e.dataTransfer.files);
  },[addFiles]);

  const onDragOver = e=>{e.preventDefault();setDragging(true);};
  const onDragLeave = ()=>setDragging(false);
  const removeFile = idx=>setAttachedFiles(prev=>prev.filter((_,i)=>i!==idx));

  const handleGenerate=async()=>{
    if(!form.작업명.trim()){setError("작업(업무)명을 입력해주세요.");return;}
    if(!form.작성자.trim()){setError("작성자를 입력해주세요.");return;}
    setError("");setStep("loading");
    try{
      const 항목=[];
      for(let i=0;i<CATS.length;i++){
        setProgress({current:i+1,label:CATS[i]});
        항목.push(await fetchOne(CATS[i],form,attachedFiles));
      }
      setResult({항목,formData:{...form}});setStep("result");
    }catch(e){setError("오류: "+e.message);setStep("input");}
  };

  const handleSave = async (saveType) => {
    if (saveType === "Word") {
      exportWord(result, "download");
    } else if (saveType === "PDF") {
      exportWord(result, "print");
    }
    showToast("✅ 저장 완료 · 관리자 적치 중...");
    Promise.all([
      logToGoogleForm(result.formData, result.항목, attachedFiles.length, saveType),
      sendEmailToAdmin(result.formData, result.항목, saveType)
    ]).then(([gf, em])=>{
      const msg = `✅ ${saveType} 저장 완료` + (gf?" · 시트 기록":"") + (em?" · 메일 발송":"");
      showToast(msg);
    });
  };

  const handleChatModify=async()=>{
    if(!chatInput.trim()||chatLoading)return;
    const userMsg=chatInput.trim();
    setChatInput("");
    setChatMsgs(p=>[...p,{role:"user",content:userMsg}]);
    setChatLoading(true);
    try{
      const prompt=`당신은 산업안전보건법 위험성평가 전문가입니다.

[기본정보]
작업명: ${result.formData.작업명} / 소속: ${result.formData.소속}

[현재 평가 내용]
${JSON.stringify(result.항목,null,2)}

[사용자 메시지]
${userMsg}

## 판단 규칙
사용자 메시지가 "직접 수정 지시"인지 "질문/상담"인지 판단합니다.

### A. 수정 지시 (예: "~로 바꿔줘", "~를 추가해줘")
{"mode":"edit","변경요약":"...","항목":[{"구분":"기계적","주요위험요인":"...","현재안전조치":"...","개선대책":"...","개선전":{"빈도":2,"강도":2},"개선후":{"빈도":1,"강도":1}},...]}
- 4개 구분(기계적/인적/물질·환경적/관리적) 순서 유지
- 한 구분에 여러 위험요인 시 문자열 내 줄바꿈으로 결합
- 빈도×강도=위험도, 위험도 1~2면 개선대책 "-"

### B. 질문/상담 (예: "어떤게 좋을까?")
{"mode":"chat","답변":"전문가 답변. 수정 제안 시 '원하시면 수정해드릴까요?'로 마무리"}

JSON만 출력. 백틱·설명 금지.`;
      const data = await callClaude([{role:"user",content:prompt}], 3000);
      const raw = data.content?.map(b=>b.text||"").join("")||"";
      const s=raw.indexOf("{"),e=raw.lastIndexOf("}");
      if(s===-1||e===-1){
        setChatMsgs(p=>[...p,{role:"assistant",content:raw.trim()||"(응답 비어있음)"}]);
        setChatLoading(false);return;
      }
      let parsed;
      try{parsed=JSON.parse(raw.slice(s,e+1));}
      catch{
        try{parsed=JSON.parse(raw.slice(s,e+1).replace(/[\u0000-\u001F\u007F]/g," ").replace(/\n|\r/g,""));}
        catch{
          setChatMsgs(p=>[...p,{role:"assistant",content:raw.trim()}]);
          setChatLoading(false);return;
        }
      }
      if(parsed.mode==="chat"||parsed.답변){
        setChatMsgs(p=>[...p,{role:"assistant",content:parsed.답변||"(답변 비어있음)"}]);
        setChatLoading(false);return;
      }
      if(Array.isArray(parsed.항목)&&parsed.항목.length>0){
        const CAT_ORDER=["기계적","인적","물질·환경적","관리적"];
        const merged=CAT_ORDER.map((cat,i)=>{
          const found=parsed.항목.find(x=>x.구분===cat);
          return found||result.항목[i];
        });
        setResult(p=>({...p,항목:merged}));
        setChatMsgs(p=>[...p,{role:"assistant",content:"✅ "+(parsed.변경요약||"수정 적용했습니다.")}]);
      }else{
        setChatMsgs(p=>[...p,{role:"assistant",content:parsed.변경요약||parsed.답변||raw.trim()}]);
      }
    }catch(e){
      setChatMsgs(p=>[...p,{role:"assistant",content:"⚠️ 오류: "+e.message,error:true}]);
    }
    setChatLoading(false);
  };

  const B="1px solid #555";
  const bTH=(ex={})=>({border:B,padding:"4px 5px",background:"#d0d7e3",color:"#111",textAlign:"center",fontWeight:700,fontSize:11,verticalAlign:"middle",...ex});
  const bTD=(ex={})=>({border:B,padding:"5px 6px",fontSize:11,verticalAlign:"middle",...ex});
  const sL=(ex={})=>({border:B,padding:"3px 4px",background:"#e8eaf0",fontSize:10,textAlign:"center",verticalAlign:"middle",fontWeight:600,...ex});
  const sV=(ex={})=>({border:B,padding:"3px 4px",fontSize:11,textAlign:"center",verticalAlign:"middle",...ex});
  const iTH=(ex={})=>({border:B,padding:"5px 8px",background:"#d0d7e3",fontWeight:700,fontSize:11,textAlign:"center",whiteSpace:"nowrap",verticalAlign:"middle",...ex});
  const iTD=(ex={})=>({border:B,padding:"5px 8px",fontSize:11,verticalAlign:"middle",...ex});

  return(
    <div style={{fontFamily:"'Malgun Gothic','Apple SD Gothic Neo',sans-serif",background:"#f0f4f8",minHeight:"100vh"}}>
      <style>{`
        .f{width:100%;padding:8px 12px;border:1.5px solid #d1d5db;border-radius:6px;font-size:14px;font-family:inherit;box-sizing:border-box}
        .f:focus{outline:none;border-color:#1e3a5f}
        .bp{background:#1e3a5f;color:white;border:none;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit}
        .bp:hover{background:#162d4a}
        .bs{background:white;color:#1e3a5f;border:2px solid #1e3a5f;padding:8px 18px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit}
        .bw{background:#2563eb;color:white;border:none;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit}
        .bw:hover{background:#1d4ed8}
        .rb{display:inline-block;padding:1px 8px;border-radius:3px;color:white;font-weight:700;font-size:11px}
        .pb{height:8px;border-radius:4px;background:#e2e8f0;overflow:hidden;margin:12px 0}
        .pf{height:100%;border-radius:4px;background:#1e3a5f;transition:width .5s}
        @keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
        @keyframes fadein{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
      `}</style>

      <div style={{background:"#1e3a5f",color:"white",padding:"14px 24px",display:"flex",alignItems:"center",gap:12}}>
        <div style={{width:34,height:34,background:"#e63946",borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>🔥</div>
        <div>
          <div style={{fontWeight:700,fontSize:15}}>수시 위험성평가 AI 작성 도우미</div>
          <div style={{fontSize:11,opacity:.7}}>한국소방산업기술원 안전관리부</div>
        </div>
      </div>

      {toast&&<div style={{position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",background:"#1e3a5f",color:"white",padding:"10px 22px",borderRadius:8,fontSize:13,fontWeight:600,zIndex:9999,animation:"fadein .3s ease",boxShadow:"0 4px 16px rgba(0,0,0,.25)"}}>{toast}</div>}

      <div style={{maxWidth:980,margin:"0 auto",padding:"22px 14px"}}>

        {step==="input"&&(
          <div style={{background:"white",borderRadius:12,padding:26,boxShadow:"0 2px 10px rgba(0,0,0,.08)"}}>
            <h2 style={{color:"#1e3a5f",margin:"0 0 18px",fontSize:16,borderBottom:"2px solid #1e3a5f",paddingBottom:9}}>📋 기본 정보 입력</h2>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:12}}>
              {[["소속","text","안전관리부"],["평가일자","date",""],["작성자","text","홍길동"]].map(([k,t,p])=>(
                <div key={k}><label style={{fontSize:12,fontWeight:600,display:"block",marginBottom:3}}>{k}</label>
                <input className="f" type={t} placeholder={p} value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})}/></div>
              ))}
            </div>
            <div style={{marginBottom:12}}>
              <label style={{fontSize:12,fontWeight:600,display:"block",marginBottom:3}}>✱ 작업(업무)명 <span style={{color:"#ef4444"}}>*</span></label>
              <input className="f" style={{fontSize:15}} placeholder="예: 사무실 이전, 전기 배선 공사, 신규 장비 설치..."
                value={form.작업명} onChange={e=>setForm({...form,작업명:e.target.value})} onKeyDown={e=>e.key==="Enter"&&handleGenerate()}/>
            </div>
            <div style={{marginBottom:12}}>
              <label style={{fontSize:12,fontWeight:600,display:"block",marginBottom:5}}>작성사유</label>
              <div style={{display:"flex",gap:16,flexWrap:"wrap",fontSize:13}}>
                {SAUSAGES.map(s=>(<label key={s} style={{display:"flex",alignItems:"center",gap:4,cursor:"pointer"}}>
                  <input type="radio" name="sr" style={{width:"auto"}} checked={form.작성사유===s} onChange={()=>setForm({...form,작성사유:s})}/>{s}
                </label>))}
              </div>
              {form.작성사유==="기타"&&<input className="f" style={{marginTop:6}} placeholder="기타 사유" value={form.기타사유} onChange={e=>setForm({...form,기타사유:e.target.value})}/>}
            </div>
            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,fontWeight:600,display:"block",marginBottom:3}}>추가 설명 <span style={{fontSize:11,color:"#9ca3af",fontWeight:400}}>(작업 환경·인원·특이사항)</span></label>
              <textarea className="f" rows={2} style={{resize:"vertical"}} placeholder="예: 3층 사무실, 작업인원 5명, 중량물 다수" value={form.추가정보} onChange={e=>setForm({...form,추가정보:e.target.value})}/>
            </div>

            <div style={{marginBottom:18}}>
              <label style={{fontSize:12,fontWeight:600,display:"block",marginBottom:6}}>
                📎 참고 문서 첨부
                <span style={{fontSize:11,color:"#9ca3af",fontWeight:400,marginLeft:6}}>PDF · 이미지 · HWP · Word · TXT</span>
              </label>
              <input ref={fileRef} type="file" multiple
                accept=".pdf,.docx,.txt,.hwp,.jpg,.jpeg,.png,.gif,.webp,.bmp"
                style={{display:"none"}} onChange={e=>addFiles(e.target.files)}/>
              <div
                onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
                onClick={()=>fileRef.current?.click()}
                style={{border:`2px dashed ${dragging?"#1e3a5f":"#cbd5e1"}`,borderRadius:10,padding:"18px 16px",textAlign:"center",cursor:"pointer",background:dragging?"#eef2ff":"#f8fafc",transition:"all .2s",marginBottom:attachedFiles.length?10:0}}>
                {fileLoading
                  ? <div style={{color:"#6b7280",fontSize:13}}>⏳ 파일 처리 중...</div>
                  : <>
                      <div style={{fontSize:28,marginBottom:4}}>📂</div>
                      <div style={{fontSize:13,fontWeight:600,color:"#475569"}}>클릭하거나 파일을 여기로 끌어오세요</div>
                      <div style={{fontSize:11,color:"#94a3b8",marginTop:3}}>공사시방서, 기기사양서, 계획안 등</div>
                    </>}
              </div>
              {attachedFiles.length>0&&(
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {attachedFiles.map((f,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:10,background:f.type==="error"?"#fef2f2":f.type==="hwp"?"#fffbeb":"#f0fdf4",border:`1.5px solid ${f.type==="error"?"#fca5a5":f.type==="hwp"?"#fde68a":"#86efac"}`,borderRadius:8,padding:"8px 12px"}}>
                      <span style={{fontSize:20}}>{FILE_ICON(f)}</span>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:700,color:"#065f46",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name}</div>
                        <div style={{fontSize:11,color:"#6b7280"}}>{FILE_DESC(f)}</div>
                      </div>
                      <button onClick={()=>removeFile(i)} style={{fontSize:11,padding:"3px 8px",borderRadius:5,border:"1px solid #dc2626",background:"white",color:"#dc2626",cursor:"pointer",flexShrink:0}}>제거</button>
                    </div>
                  ))}
                  <button onClick={()=>fileRef.current?.click()} style={{fontSize:12,padding:"6px",borderRadius:6,border:"1.5px dashed #cbd5e1",background:"transparent",color:"#64748b",cursor:"pointer"}}>+ 파일 추가</button>
                </div>
              )}
            </div>

            {error&&<div style={{color:"#ef4444",fontSize:12,marginBottom:12,background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:6,padding:10}}>⚠️ {error}</div>}
            <button className="bp" onClick={handleGenerate} style={{width:"100%",padding:13,fontSize:15}}>🤖 AI 위험성평가표 자동 작성</button>
            <div style={{marginTop:10,padding:9,background:"#f0f4f8",borderRadius:7,fontSize:12,color:"#6b7280"}}>
              💡 기계적 · 인적 · 물질·환경적 · 관리적 4개 구분을 순서대로 분석합니다.
              {attachedFiles.length>0&&<span style={{color:"#1e3a5f",fontWeight:600}}> &nbsp;📎 첨부파일 {attachedFiles.length}개 참고</span>}
            </div>
          </div>
        )}

        {step==="loading"&&(
          <div style={{background:"white",borderRadius:12,padding:52,textAlign:"center",boxShadow:"0 2px 10px rgba(0,0,0,.08)"}}>
            <div style={{fontSize:42,marginBottom:14,display:"inline-block",animation:"spin 1.2s linear infinite"}}>⚙️</div>
            <div style={{fontSize:16,fontWeight:700,color:"#1e3a5f",marginBottom:6}}>AI가 위험성평가 작성 중...</div>
            <div style={{color:"#6b7280",fontSize:13,marginBottom:14}}>{progress.current>0?`${progress.current} / 4  —  [${progress.label}] 분석 중`:"준비 중..."}</div>
            <div className="pb"><div className="pf" style={{width:`${(progress.current/4)*100}%`}}></div></div>
            <div style={{display:"flex",justifyContent:"space-around",fontSize:11,marginTop:8}}>
              {CATS.map((c,i)=>(<span key={c} style={{color:i<progress.current?"#1e3a5f":"#cbd5e1",fontWeight:i===progress.current-1?700:400}}>
                {i<progress.current?"✓ ":i===progress.current-1?"● ":"○ "}{c}
              </span>))}
            </div>
          </div>
        )}

        {step==="result"&&result&&(()=>{
          const fd=result.formData;
          return(
            <div>
              <div style={{display:"flex",gap:9,marginBottom:14,justifyContent:"flex-end",flexWrap:"wrap"}}>
                <button className="bs" onClick={()=>{setStep("input");setResult(null);}}>← 다시 작성</button>
                <button className="bw" onClick={()=>handleSave("Word")}>📄 Word 저장</button>
                <button className="bp" onClick={()=>handleSave("PDF")}>🖨️ 인쇄 / PDF</button>
              </div>
              <div style={{background:"white",borderRadius:8,padding:"18px 20px",boxShadow:"0 2px 10px rgba(0,0,0,.08)"}}>
                <div style={{display:"flex",alignItems:"flex-start",marginBottom:10}}>
                  <div style={{flex:1,textAlign:"center",paddingTop:8}}>
                    <h1 style={{fontSize:22,fontWeight:900,letterSpacing:8,margin:0,color:"#111"}}>수시 위험성평가표</h1>
                  </div>
                  <table style={{borderCollapse:"collapse",flexShrink:0,marginLeft:20}}>
                    <tbody>
                      <tr>
                        <td style={{border:B,padding:"3px 22px",background:"#d0d7e3",textAlign:"center",fontSize:10,fontWeight:700,minWidth:60}}>작 성</td>
                        <td style={{border:B,padding:"3px 22px",background:"#d0d7e3",textAlign:"center",fontSize:10,fontWeight:700,minWidth:60}}>승 인</td>
                      </tr>
                      <tr><td style={{border:B,height:46,width:64}}></td><td style={{border:B,height:46,width:64}}></td></tr>
                    </tbody>
                  </table>
                </div>
                <table style={{borderCollapse:"collapse",width:"100%",marginBottom:8}}>
                  <colgroup><col style={{width:"7%"}}/><col style={{width:"30%"}}/><col style={{width:"7%"}}/><col/></colgroup>
                  <tbody>
                    <tr><td style={iTH()}>소&nbsp;&nbsp;&nbsp;속</td><td style={iTD()}>{fd.소속}</td><td style={iTH()}>작&nbsp;성&nbsp;자</td><td style={iTD()}>{fd.작성자}</td></tr>
                    <tr><td style={iTH()}>작업(업무)명</td><td style={iTD({fontWeight:700})} colSpan={3}>{fd.작업명}</td></tr>
                    <tr><td style={iTH()}>평&nbsp;가&nbsp;일&nbsp;자</td><td style={iTD()} colSpan={3}>{fmtDate(fd.평가일자)}</td></tr>
                    <tr><td style={iTH()}>작&nbsp;성&nbsp;사&nbsp;유</td>
                      <td style={iTD()} colSpan={3}>{SAUSAGES.map(s=>(<span key={s} style={{marginRight:18,fontSize:12}}>{fd.작성사유===s?"■":"□"} {s}{s==="기타"&&fd.기타사유?`(${fd.기타사유})`:""}</span>))}</td>
                    </tr>
                  </tbody>
                </table>
                <table style={{borderCollapse:"collapse",width:"100%"}}>
                  <colgroup>
                    <col style={{width:"6%"}}/><col style={{width:"9%"}}/><col style={{width:"5%"}}/><col style={{width:"5%"}}/><col style={{width:"5%"}}/>
                    <col style={{width:"16%"}}/><col style={{width:"9%"}}/><col style={{width:"5%"}}/><col style={{width:"5%"}}/><col style={{width:"5%"}}/>
                    <col style={{width:"7%"}}/><col style={{width:"6%"}}/><col style={{width:"7%"}}/><col style={{width:"10%"}}/>
                  </colgroup>
                  <thead>
                    <tr>
                      <th style={bTH()}>구분</th><th colSpan={4} style={bTH()}>주요위험요인</th>
                      <th style={bTH()}>현재 안전조치</th><th colSpan={4} style={bTH()}>개선대책</th>
                      <th style={bTH()}>개선<br/>예정일</th><th style={bTH()}>완료<br/>확인일</th>
                      <th style={bTH()}>평가<br/>구분</th><th style={bTH()}>담당자<br/>(작성자)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.항목.map((item,idx)=>{
                      const b=item.개선전||{},a=item.개선후||{};
                      const bS=(b.빈도||1)*(b.강도||1);
                      const lowRisk=bS<=2;
                      const aS=lowRisk?"-":(a.빈도||1)*(a.강도||1);
                      const muted={color:"#9ca3af"};
                      return(<React.Fragment key={idx}>
                        <tr>
                          <td rowSpan={2} style={bTD({textAlign:"center",fontWeight:700,fontSize:12,background:"#dce3ee",verticalAlign:"middle"})}>{item.구분}</td>
                          <td colSpan={4} style={bTD({lineHeight:1.7,verticalAlign:"top"})}>{item.주요위험요인}</td>
                          <td rowSpan={2} style={bTD({lineHeight:1.7,verticalAlign:"top"})}>{item.현재안전조치}</td>
                          <td colSpan={4} style={bTD({lineHeight:1.7,verticalAlign:"top",textAlign:lowRisk?"center":"left",...(lowRisk?muted:{})})}>{lowRisk?"-":item.개선대책}</td>
                          <td rowSpan={2} style={bTD()}></td><td rowSpan={2} style={bTD()}></td>
                          <td style={bTD({textAlign:"center",fontSize:11})}>□ 적정</td>
                          <td rowSpan={2} style={bTD()}></td>
                        </tr>
                        <tr>
                          <td style={sL()}>개선전</td><td style={sV()}>{b.빈도||1}</td><td style={sV()}>{b.강도||1}</td>
                          <td style={sV()}><span className="rb" style={{background:riskBg(bS)}}>{bS}</span></td>
                          <td style={sL()}>개선후</td>
                          <td style={sV(lowRisk?muted:{})}>{lowRisk?"-":(a.빈도||1)}</td>
                          <td style={sV(lowRisk?muted:{})}>{lowRisk?"-":(a.강도||1)}</td>
                          <td style={sV()}>{lowRisk?<span style={muted}>-</span>:<span className="rb" style={{background:riskBg(aS)}}>{aS}</span>}</td>
                          <td style={bTD({textAlign:"center",fontSize:11})}>□ 보완</td>
                        </tr>
                        {idx<result.항목.length-1&&<tr><td colSpan={14} style={{height:5,background:"#f5f5f5",border:B}}></td></tr>}
                      </React.Fragment>);
                    })}
                  </tbody>
                </table>
                <div style={{display:"flex",gap:14,fontSize:11,color:"#666",marginTop:8,flexWrap:"wrap"}}>
                  <span>위험도 = 빈도 × 강도 &nbsp;|</span>
                  <span><span className="rb" style={{background:"#ef4444"}}>6~9</span> 높음</span>
                  <span><span className="rb" style={{background:"#f59e0b"}}>3~4</span> 보통</span>
                  <span><span className="rb" style={{background:"#22c55e"}}>1~2</span> 낮음</span>
                </div>
                <div style={{marginTop:10,padding:9,background:"#fef3c7",borderRadius:7,fontSize:12,color:"#92400e"}}>
                  ⚠️ AI 작성 내용 검토 후 공란(개선예정일·완료확인일·담당자 서명)을 자필로 기재하여 정식 문서로 활용하세요.
                </div>
              </div>

              <div style={{marginTop:14,background:"white",borderRadius:10,padding:"16px 18px",boxShadow:"0 2px 10px rgba(0,0,0,.08)"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,borderBottom:"2px solid #1e3a5f",paddingBottom:8,flexWrap:"wrap"}}>
                  <span style={{fontSize:16}}>💬</span>
                  <div style={{fontSize:14,fontWeight:700,color:"#1e3a5f"}}>AI와 대화하며 수정하기</div>
                  <span style={{fontSize:11,color:"#6b7280",fontWeight:400,flex:1,minWidth:200}}>예: "기계적 위험요인을 중량물 취급으로 바꿔줘"</span>
                  {chatMsgs.length>0&&(
                    <button onClick={()=>setChatMsgs([])} style={{fontSize:11,padding:"3px 10px",borderRadius:5,border:"1px solid #cbd5e1",background:"white",color:"#64748b",cursor:"pointer",fontFamily:"inherit"}}>대화 초기화</button>
                  )}
                </div>
                {chatMsgs.length>0&&(
                  <div style={{maxHeight:260,overflowY:"auto",marginBottom:10,display:"flex",flexDirection:"column",gap:6,padding:"4px 2px"}}>
                    {chatMsgs.map((m,i)=>(
                      <div key={i} style={{alignSelf:m.role==="user"?"flex-end":"flex-start",maxWidth:"85%",background:m.role==="user"?"#1e3a5f":(m.error?"#fef2f2":"#f0fdf4"),color:m.role==="user"?"white":(m.error?"#991b1b":"#065f46"),padding:"8px 13px",borderRadius:12,fontSize:12.5,lineHeight:1.55,border:m.error?"1px solid #fca5a5":"none",whiteSpace:"pre-wrap",wordBreak:"break-word"}}>
                        {m.content}
                      </div>
                    ))}
                    {chatLoading&&(
                      <div style={{alignSelf:"flex-start",background:"#f0fdf4",color:"#065f46",padding:"8px 13px",borderRadius:12,fontSize:12.5}}>⏳ AI가 수정 중...</div>
                    )}
                  </div>
                )}
                <div style={{display:"flex",gap:8}}>
                  <input className="f" style={{flex:1}} placeholder="수정할 내용을 입력하세요 (Enter로 전송)" value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!chatLoading)handleChatModify();}} disabled={chatLoading}/>
                  <button className="bp" onClick={handleChatModify} disabled={chatLoading||!chatInput.trim()} style={{opacity:chatLoading||!chatInput.trim()?.5:1,cursor:chatLoading||!chatInput.trim()?"not-allowed":"pointer"}}>
                    {chatLoading?"수정중":"전송"}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
