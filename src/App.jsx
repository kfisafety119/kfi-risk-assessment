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
      model: "claude-opus-4-7",
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
      return {name:file.name, type:"blocked", content:"", reason:"hwp"};
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

const LEGAL_REF = {
  "기계적": `- 산업안전보건법 제80~87조(기계·기구 방호조치), 제38조(안전조치), 산업안전보건기준에 관한 규칙 제1편 기계·기구편
- 전기안전관리법(감전·전기화재), 고압가스안전관리법(압력용기·배관)
- KOSHA-GUIDE G-4(기계안전), G-83(전기작업안전), G-172(중량물 취급)`,
  "인적": `- 산업안전보건법 제29조(안전보건교육), 제38~39조(유해·위험 작업), 제63조(도급인 안전조치)
- 중대재해처벌법 제4~5조(사업주·경영책임자 안전보건 확보 의무)
- KOSHA-GUIDE H-9(인간공학적 위험요인), H-67(근골격계질환 예방)`,
  "물질·환경적": `- 산업안전보건법 제105~116조(화학물질 관리), 제39조(보건조치), 산업안전보건기준에 관한 규칙 제3편 보건기준편
- 화학물질관리법(유해화학물질 취급·보관), 화학물질의 분류·표시에 관한 규정(GHS/MSDS)
- 고압가스안전관리법(가스류), 위험물안전관리법(인화성·가연성 물질)
- KOSHA-GUIDE W-4(화학물질 위험성평가), W-12(밀폐공간 질식), 작업환경측정 관련 고시`,
  "관리적": `- 중대재해처벌법 제4조(안전보건관리체계 구축), 제5조(재해 재발방지 의무)
- 산업안전보건법 제15~19조(안전보건관리체제), 제25~26조(안전보건관리규정), 제36조(위험성평가)
- 산업안전보건기준에 관한 규칙 제2편 안전기준 중 관리·표지 조항
- KOSHA-GUIDE P-3(안전보건관리체계), KOSHA-MS 인정기준`
};

async function fetchOne(구분, jobInfo, files) {
  const prompt=`당신은 산업안전보건법·중대재해처벌법 및 관계법령에 정통한 위험성평가 전문가입니다.
4M기법에 따라 아래 작업의 [${구분}] 분야 위험요인을 도출하고 수시 위험성평가를 작성하세요.

작업명: ${jobInfo.작업명} / 소속: ${jobInfo.소속} / 작성사유: ${jobInfo.작성사유}
추가설명: ${jobInfo.추가정보||"없음"}

## [${구분}] 분야 적용 법령 및 기준
${LEGAL_REF[구분] || "산업안전보건법, 중대재해처벌법, 관련 KOSHA-GUIDE"}

## 작성 지침
- 주요위험요인: 위 법령·KOSHA-GUIDE 기준에서 실제로 문제가 될 수 있는 구체적 위험 상황 기재
- 현재안전조치: 관련 법령 기준 충족 여부 및 현재 이행 중인 조치 명시
- 개선대책: 위험도 3 이상 시 적용 법령·고시·KOSHA-GUIDE 번호를 포함한 구체적 이행 조치 기재
- 해당 없으면: 주요위험요인="해당 없음", 나머지="-", 빈도=1, 강도=1
- 위험도 1~2: 개선대책="-" (현재 안전조치 유지) / 위험도 3 이상: 법령 근거 포함 개선대책 필수
- 첨부파일 있으면 내용을 참고하여 더 정확한 위험요인 도출
- 실제 작업 특성에 맞게 점수 판단, 과도하게 높은 점수 금지

## 위험도 기준
빈도: 상=3(월1회이상) 중=2(연1회) 하=1(3년이하) / 강도: 대=3(사망·장애) 중=2(의료처치) 소=1(아차사고) / 위험도=빈도×강도

## 출력: JSON 객체만 (백틱·설명 금지, 문자열 내 큰따옴표→작은따옴표)
{"구분":"${구분}","주요위험요인":"...","현재안전조치":"...","개선대책":"...","개선전":{"빈도":2,"강도":2},"개선후":{"빈도":1,"강도":1}}`;
  const content = buildContent(prompt, files);
  const data = await callClaude([{role:"user",content}], 1500);
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

async function exportDocx(result) {
  const fd = result.formData;
  const {
    Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun,
    AlignmentType, VerticalAlign, WidthType, BorderStyle, ShadingType,
    PageOrientation, VerticalMergeType, HeightRule, TableLayoutType,
  } = await import("docx");

  const mm = v => Math.round(v * 56.692);
  // A4 landscape: docx 라이브러리는 landscape 시 width↔height를 내부적으로 swap함
  // → Word가 기대하는 w:w=16838(297mm), w:h=11905(210mm)를 얻으려면 인자를 반대로 전달
  const PW = mm(297), PH = mm(210), MG = mm(10);
  const UW = PW - MG * 2; // 실제 가로 사용 너비: 297mm - 20mm = 277mm

  // 14열 비율 (화면 colgroup과 동일, 합계 100%) → twips
  const CW = [6,9,5,5,5,16,9,5,5,5,7,6,7,10].map(p => Math.round(UW * p / 100));
  CW[CW.length - 1] += UW - CW.reduce((a, b) => a + b, 0); // 반올림 오차 보정

  const FN = "맑은 고딕";
  const bd = { style: BorderStyle.SINGLE, size: 6, color: "555555" };
  const B  = { top: bd, bottom: bd, left: bd, right: bd };
  const nb = { style: BorderStyle.NONE };
  const NB = { top: nb, bottom: nb, left: nb, right: nb };
  const shHdr  = { type: ShadingType.SOLID, color: "d0d7e3", fill: "d0d7e3" };
  const shSub  = { type: ShadingType.SOLID, color: "e8eaf0", fill: "e8eaf0" };
  const shSep  = { type: ShadingType.SOLID, color: "f5f5f5", fill: "f5f5f5" };
  const shGray = { type: ShadingType.SOLID, color: "f5f5f5", fill: "f5f5f5" };
  const shRisk = s => { const c = s>=6?"FECACA":s>=3?"FDE68A":"BBF7D0"; return {type:ShadingType.SOLID,color:c,fill:c}; };

  const run = (text, sz=14, bold=false, color="000000") =>
    new TextRun({ text: String(text??''), font: FN, size: sz, bold, color });
  const par = (runs, al=AlignmentType.CENTER) =>
    new Paragraph({ children:[runs].flat(), alignment: al, spacing:{before:30,after:30} });
  const tc = (children, opts={}) => new TableCell({
    children: [children].flat(),
    borders: opts.nb ? NB : B,
    verticalAlign: opts.va || VerticalAlign.CENTER,
    shading: opts.sh,
    columnSpan: opts.cs,
    verticalMerge: opts.vm,
    width: opts.w ? {size:opts.w, type:WidthType.DXA} : undefined,
  });
  const HC = (txt, opts={}) => tc(par(run(txt,14,true)),   {sh:shHdr,...opts});
  const DC = (txt, opts={}) => tc(par(run(txt,14,false,opts.color||"000000"), opts.al||AlignmentType.CENTER), opts);
  const EC = (opts={})      => tc(par(run("")), opts);

  // ── 결재란 ──
  const apvTbl = new Table({
    width: {size:mm(60), type:WidthType.DXA},
    rows: [
      new TableRow({children:[HC("작  성",{w:mm(30)}), HC("승  인",{w:mm(30)})]}),
      new TableRow({children:[EC({w:mm(30)}), EC({w:mm(30)})]}),
    ],
  });

  // ── 제목 + 결재란 (비표시 테이블로 좌우 배치) ──
  const titleTbl = new Table({
    width: {size:UW, type:WidthType.DXA},
    rows: [new TableRow({children:[
      tc(par(run("수시 위험성평가표",40,true)), {nb:true}),
      tc([apvTbl], {nb:true, w:mm(64), va:VerticalAlign.TOP}),
    ]})],
  });

  // ── 기본정보 ──
  const 사유s = SAUSAGES.map(s =>
    `${fd.작성사유===s?"■":"□"} ${s}${s==="기타"&&fd.기타사유?`(${fd.기타사유})`:""}`
  ).join("   ");
  const infoTbl = new Table({
    width: {size:UW, type:WidthType.DXA},
    rows: [
      new TableRow({children:[HC("소     속"), DC(fd.소속||"",{al:AlignmentType.LEFT}), HC("작  성  자"), DC(fd.작성자||"",{al:AlignmentType.LEFT})]}),
      new TableRow({children:[HC("작업(업무)명"), tc(par(run(fd.작업명||"",14,true),AlignmentType.LEFT),{cs:3})]}),
      new TableRow({children:[HC("평  가  일  자"), tc(par(run(fmtDate(fd.평가일자),14),AlignmentType.LEFT),{cs:3})]}),
      new TableRow({children:[HC("작  성  사  유"), tc(par(run(사유s,14),AlignmentType.LEFT),{cs:3})]}),
    ],
  });

  // ── 주평가표 ──
  const mainRows = [
    new TableRow({
      tableHeader: true,
      children: [
        HC("구분",        {w:CW[0]}),
        HC("주요위험요인", {cs:4, w:CW[1]+CW[2]+CW[3]+CW[4]}),
        HC("현재\n안전조치",{w:CW[5]}),
        HC("개선대책",     {cs:4, w:CW[6]+CW[7]+CW[8]+CW[9]}),
        HC("개선\n예정일", {w:CW[10]}),
        HC("완료\n확인일", {w:CW[11]}),
        HC("평가\n구분",   {w:CW[12]}),
        HC("담당자\n(작성자)",{w:CW[13]}),
      ],
    }),
  ];

  result.항목.forEach((item, idx) => {
    const b=item.개선전||{}, a=item.개선후||{};
    const bF=b.빈도||1, bI=b.강도||1, bS=bF*bI;
    const low = bS<=2;
    const aSn = low ? 0 : (a.빈도||1)*(a.강도||1);
    const aF  = low ? "-" : String(a.빈도||1);
    const aI  = low ? "-" : String(a.강도||1);
    const aS  = low ? "-" : String(aSn);
    const gray = "9ca3af";

    // Row A
    mainRows.push(new TableRow({children:[
      tc(par(run(item.구분,14,true)),                                                   {sh:shHdr, vm:VerticalMergeType.RESTART}),
      tc(par(run(item.주요위험요인||"",14), AlignmentType.LEFT),                        {cs:4}),
      tc(par(run(item.현재안전조치||"",14), AlignmentType.LEFT),                        {vm:VerticalMergeType.RESTART}),
      tc(par(run(low?"-":(item.개선대책||""),14,false,low?gray:"000000"), low?AlignmentType.CENTER:AlignmentType.LEFT), {cs:4}),
      EC({vm:VerticalMergeType.RESTART}),
      EC({vm:VerticalMergeType.RESTART}),
      tc(par(run("□ 적정",14))),
      EC({vm:VerticalMergeType.RESTART}),
    ]}));

    // Row B
    mainRows.push(new TableRow({children:[
      EC({vm:VerticalMergeType.CONTINUE}),
      tc(par(run("개선전",13,true)), {sh:shSub}),
      DC(String(bF)),
      DC(String(bI)),
      tc(par(run(String(bS),14,true,"ffffff")), {sh:shRisk(bS)}),
      EC({vm:VerticalMergeType.CONTINUE}),
      tc(par(run("개선후",13,true)), {sh:shSub}),
      DC(aF, {color:low?gray:"000000"}),
      DC(aI, {color:low?gray:"000000"}),
      low
        ? tc(par(run("-",14,false,gray)), {sh:shGray})
        : tc(par(run(aS,14,true,"ffffff")), {sh:shRisk(aSn)}),
      EC({vm:VerticalMergeType.CONTINUE}),
      EC({vm:VerticalMergeType.CONTINUE}),
      tc(par(run("□ 보완",14))),
      EC({vm:VerticalMergeType.CONTINUE}),
    ]}));

    // 구분선 (마지막 항목 제외)
    if (idx < result.항목.length - 1) {
      mainRows.push(new TableRow({
        height: {value:80, rule:HeightRule.EXACT},
        children: [new TableCell({children:[new Paragraph({children:[]})], columnSpan:14, borders:B, shading:shSep})],
      }));
    }
  });

  const mainTbl = new Table({width:{size:UW,type:WidthType.DXA}, columnWidths:CW, layout:TableLayoutType.FIXED, rows:mainRows});

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: {orientation:PageOrientation.LANDSCAPE, width:PH, height:PW},
          margin: {top:MG, right:MG, bottom:MG, left:MG},
        },
      },
      children: [
        titleTbl,
        new Paragraph({children:[], spacing:{before:60,after:60}}),
        infoTbl,
        new Paragraph({children:[], spacing:{before:60,after:60}}),
        mainTbl,
        new Paragraph({
          children:[run("위험도 = 빈도 × 강도  |  6~9: 높음(허용불가)  |  3~4: 보통(개선필요)  |  1~2: 낮음(허용가능)",14,false,"666666")],
          alignment:AlignmentType.LEFT, spacing:{before:60,after:40},
        }),
        new Paragraph({
          children:[run("⚠ AI 작성 내용 검토 후 공란(개선예정일·완료확인일·담당자 서명)을 자필로 기재하여 정식 문서로 활용하세요.",14,false,"92400e")],
          alignment:AlignmentType.LEFT,
        }),
      ],
    }],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `수시위험성평가_${fd.작업명||"평가"}_${fd.평가일자||""}.docx`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function exportPDF(result) {
  const fd = result.formData;
  const 사유str = SAUSAGES.map(s=>`${fd.작성사유===s?"■":"□"} ${s}${s==="기타"&&fd.기타사유?`(${fd.기타사유})`:""}`).join("   ");
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
    const t=lowRisk?"#999":"#000";
    return `
      <tr>
        <td rowspan="2" style="border:1px solid #555;padding:4px 3px;text-align:center;font-weight:bold;background:#dce3ee;vertical-align:middle;font-size:8pt;">${item.구분}</td>
        <td colspan="4" style="border:1px solid #555;padding:4px 3px;vertical-align:top;font-size:7.5pt;line-height:1.5;">${(item.주요위험요인||"").replace(/\n/g,"<br>")}</td>
        <td rowspan="2" style="border:1px solid #555;padding:4px 3px;vertical-align:top;font-size:7.5pt;line-height:1.5;">${(item.현재안전조치||"").replace(/\n/g,"<br>")}</td>
        <td colspan="4" style="border:1px solid #555;padding:4px 3px;vertical-align:top;font-size:7.5pt;line-height:1.5;text-align:${lowRisk?"center":"left"};color:${t};">${개선대책.replace(/\n/g,"<br>")}</td>
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
        <td style="border:1px solid #555;padding:3px;text-align:center;font-size:8pt;color:${t};">${aF}</td>
        <td style="border:1px solid #555;padding:3px;text-align:center;font-size:8pt;color:${t};">${aI}</td>
        <td style="border:1px solid #555;padding:3px;text-align:center;background:${aCol};font-weight:bold;font-size:8pt;color:${t};">${aS}</td>
      </tr>
      <tr><td colspan="14" style="height:3px;background:#f5f5f5;border:1px solid #ddd;"></td></tr>`;
  }).join("");

  const inner = `
    <table style="margin-bottom:3px;border-collapse:collapse;width:100%;table-layout:fixed;">
      <tr>
        <td style="width:75%;"><h1 style="text-align:center;font-size:14pt;letter-spacing:6px;margin:4px 0;">수시 위험성평가표</h1></td>
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
    <table style="margin-bottom:2px;border-collapse:collapse;width:100%;table-layout:fixed;">
      <colgroup><col style="width:8%"><col style="width:38%"><col style="width:8%"><col></colgroup>
      <tr><td style="background:#d0d7e3;font-weight:bold;text-align:center;padding:3px 4px;border:1px solid #555;font-size:8pt;white-space:nowrap;">소&nbsp;&nbsp;&nbsp;속</td><td style="padding:3px 5px;border:1px solid #555;font-size:8pt;">${fd.소속||""}</td><td style="background:#d0d7e3;font-weight:bold;text-align:center;padding:3px 4px;border:1px solid #555;font-size:8pt;white-space:nowrap;">작&nbsp;성&nbsp;자</td><td style="padding:3px 5px;border:1px solid #555;font-size:8pt;">${fd.작성자||""}</td></tr>
      <tr><td style="background:#d0d7e3;font-weight:bold;text-align:center;padding:3px 4px;border:1px solid #555;font-size:8pt;white-space:nowrap;">작업(업무)명</td><td style="padding:3px 5px;border:1px solid #555;font-size:8pt;" colspan="3"><b>${fd.작업명||""}</b></td></tr>
      <tr><td style="background:#d0d7e3;font-weight:bold;text-align:center;padding:3px 4px;border:1px solid #555;font-size:8pt;white-space:nowrap;">평&nbsp;가&nbsp;일&nbsp;자</td><td style="padding:3px 5px;border:1px solid #555;font-size:8pt;" colspan="3">${fmtDate(fd.평가일자)}</td></tr>
      <tr><td style="background:#d0d7e3;font-weight:bold;text-align:center;padding:3px 4px;border:1px solid #555;font-size:8pt;white-space:nowrap;">작&nbsp;성&nbsp;사&nbsp;유</td><td style="padding:3px 5px;border:1px solid #555;font-size:7.5pt;" colspan="3">${사유str}</td></tr>
    </table>
    <table style="border-collapse:collapse;width:100%;table-layout:fixed;">
      <colgroup>
        <col style="width:5%"><col style="width:8%"><col style="width:3.5%"><col style="width:3.5%"><col style="width:4%">
        <col style="width:13%"><col style="width:8%"><col style="width:3.5%"><col style="width:3.5%"><col style="width:4%">
        <col style="width:9%"><col style="width:9%"><col style="width:8%"><col style="width:14%">
      </colgroup>
      <tr>
        <th style="background:#d0d7e3;font-weight:bold;text-align:center;padding:3px 2px;border:1px solid #555;font-size:8pt;">구분</th>
        <th style="background:#d0d7e3;font-weight:bold;text-align:center;padding:3px 2px;border:1px solid #555;font-size:8pt;" colspan="4">주요위험요인</th>
        <th style="background:#d0d7e3;font-weight:bold;text-align:center;padding:3px 2px;border:1px solid #555;font-size:8pt;">현재 안전조치</th>
        <th style="background:#d0d7e3;font-weight:bold;text-align:center;padding:3px 2px;border:1px solid #555;font-size:8pt;" colspan="4">개선대책</th>
        <th style="background:#d0d7e3;font-weight:bold;text-align:center;padding:3px 2px;border:1px solid #555;font-size:8pt;white-space:nowrap;">개선예정일</th>
        <th style="background:#d0d7e3;font-weight:bold;text-align:center;padding:3px 2px;border:1px solid #555;font-size:8pt;white-space:nowrap;">완료확인일</th>
        <th style="background:#d0d7e3;font-weight:bold;text-align:center;padding:3px 2px;border:1px solid #555;font-size:8pt;white-space:nowrap;">평가구분</th>
        <th style="background:#d0d7e3;font-weight:bold;text-align:center;padding:3px 2px;border:1px solid #555;font-size:8pt;white-space:nowrap;">담당자(작성자)</th>
      </tr>
      ${rows}
    </table>
    <p style="font-size:7.5pt;color:#666;margin:3px 0 0;">위험도 = 빈도 × 강도 &nbsp;|&nbsp; 6~9: 높음 &nbsp;|&nbsp; 3~4: 보통 &nbsp;|&nbsp; 1~2: 낮음</p>
    <p style="font-size:7.5pt;color:#92400e;background:#fef3c7;padding:4px 6px;margin:3px 0 0;">⚠ AI 작성 내용 검토 후 공란(개선예정일·완료확인일·담당자 서명)을 자필로 기재하여 정식 문서로 활용하세요.</p>
  `;

  const wrap = document.createElement('div');
  // A4 landscape 297mm ≈ 1122px at 96dpi, padding 10mm ≈ 38px each side
  wrap.style.cssText = 'position:fixed;top:0;left:-9999px;width:1122px;padding:38px;box-sizing:border-box;background:#fff;font-family:"맑은 고딕","Malgun Gothic",sans-serif;font-size:8.5pt;';
  wrap.innerHTML = inner;
  document.body.appendChild(wrap);
  await document.fonts.ready;

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  const canvas = await html2canvas(wrap, { scale: 2, useCORS: true, backgroundColor: '#fff', logging: false });
  document.body.removeChild(wrap);

  const pW = 297, pH = 210;
  const ratio = pW / canvas.width;
  const totalH = canvas.height * ratio;
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  if (totalH <= pH) {
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pW, totalH);
  } else {
    const pageHpx = Math.floor(pH / ratio);
    for (let p = 0; p * pageHpx < canvas.height; p++) {
      if (p > 0) pdf.addPage([297, 210], 'landscape');
      const sy = p * pageHpx, sh = Math.min(pageHpx, canvas.height - sy);
      const pc = document.createElement('canvas');
      pc.width = canvas.width; pc.height = sh;
      pc.getContext('2d').drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, canvas.width, sh);
      pdf.addImage(pc.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pW, sh * ratio);
    }
  }

  pdf.save(`수시위험성평가_${fd.작업명||"평가"}_${fd.평가일자||""}.pdf`);
}

const FILE_ICON = f => {
  if(f.type==="pdf") return "📕";
  if(f.type==="image") return "🖼️";
  if(f.type==="text") return f.name.endsWith(".docx")?"📝":"📄";
  if(f.type==="blocked") return "🚫";
  return "📎";
};
const FILE_DESC = f => {
  if(f.type==="pdf") return "PDF — AI 직접 분석";
  if(f.type==="image") return "이미지 — AI 직접 분석";
  if(f.type==="text") return `텍스트 추출 완료 (${f.content?.length?.toLocaleString()}자)`;
  if(f.type==="blocked") return "❌ 차단됨 (지원하지 않는 파일)";
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
  const [history, setHistory] = useState([]);
  const HISTORY_MAX = 5;
  const [chatAttachedFiles, setChatAttachedFiles] = useState([]);
  const [chatFileLoading, setChatFileLoading] = useState(false);
  const fileRef=useRef();

  const showToast=msg=>{setToast(msg);setTimeout(()=>setToast(""),3000);};

  const addFiles = useCallback(async(fileList)=>{
    let files = Array.from(fileList);
    if(!files.length) return;
    const hwpFiles = files.filter(f=>(f.name.split(".").pop()||"").toLowerCase()==="hwp");
    if(hwpFiles.length>0){
      setToast(`⚠️ HWP 파일(${hwpFiles.length}개)은 첨부할 수 없습니다. PDF로 변환 후 업로드해주세요.`);
      setTimeout(()=>setToast(""),5000);
      files = files.filter(f=>(f.name.split(".").pop()||"").toLowerCase()!=="hwp");
      if(files.length===0) return;
    }
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
      try {
        await exportDocx(result);
      } catch (e) {
        showToast("❌ DOCX 생성 오류: " + e.message);
        console.error("exportDocx error:", e);
        return;
      }
    } else if (saveType === "PDF") {
      try {
        await exportPDF(result);
      } catch (e) {
        showToast("❌ PDF 생성 오류: " + e.message);
        console.error("exportPDF error:", e);
        return;
      }
    } else if (saveType === "인쇄") {
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
      const prompt=`당신은 산업안전보건법·중대재해처벌법 및 관계법령에 정통한 위험성평가 전문가입니다.
4M기법(기계적·인적·물질·환경적·관리적) 기반으로 아래 평가 내용을 검토하고 사용자 요청에 응답하세요.

[적용 법령 체계]
- 기계적: 산업안전보건법 제80~87조, 전기안전관리법, 고압가스안전관리법, KOSHA-GUIDE G-series
- 인적: 산업안전보건법 제29·38~39·63조, 중대재해처벌법 제4~5조, KOSHA-GUIDE H-series
- 물질·환경적: 산업안전보건법 제105~116조, 화학물질관리법, 고압가스안전관리법, GHS/MSDS, KOSHA-GUIDE W-series
- 관리적: 중대재해처벌법 제4~5조, 산업안전보건법 제15~19·25~26·36조, KOSHA-GUIDE P-series

[기본정보]
작업명: ${result.formData.작업명} / 소속: ${result.formData.소속}

[현재 평가 내용]
${JSON.stringify(result.항목,null,2)}

[채팅 첨부파일]
${chatAttachedFiles.length > 0 ? chatAttachedFiles.map(f=>`- ${f.name}`).join("\n") : "(없음)"}

채팅 첨부파일이 있다면 그 내용도 참고하여 더 정확하게 수정해주세요.

[사용자 메시지]
${userMsg}

## 판단 규칙
사용자 메시지가 "직접 수정 지시"인지 "질문/상담"인지 판단합니다.

### A. 수정 지시 (예: "~로 바꿔줘", "~를 추가해줘")
{"mode":"edit","변경요약":"...","항목":[{"구분":"기계적","주요위험요인":"...","현재안전조치":"...","개선대책":"...","개선전":{"빈도":2,"강도":2},"개선후":{"빈도":1,"강도":1}},...]}
- 4개 구분(기계적/인적/물질·환경적/관리적) 순서 유지
- 개선대책: 위험도 3 이상 시 관련 법령·KOSHA-GUIDE 번호 포함 / 위험도 1~2면 "-"
- 빈도×강도=위험도, 한 구분에 여러 위험요인 시 문자열 내 줄바꿈으로 결합

### B. 질문/상담 (예: "어떤게 좋을까?", 법령 해석 등)
{"mode":"chat","답변":"관련 법령·KOSHA-GUIDE 근거를 포함한 전문가 답변. 수정 제안 시 '원하시면 수정해드릴까요?'로 마무리"}

JSON만 출력. 백틱·설명 금지.`;
      const content = chatAttachedFiles.length > 0
        ? buildContent(prompt, chatAttachedFiles)
        : prompt;
      const data = await callClaude([{role:"user",content}], 3000);
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
        setHistory(h=>{
          const next=[...h, JSON.parse(JSON.stringify(result.항목))];
          return next.slice(-HISTORY_MAX);
        });
        setResult(p=>({...p,항목:merged}));
        setChatMsgs(p=>[...p,{role:"assistant",content:"✅ "+(parsed.변경요약||"수정 적용했습니다.")}]);
      }else{
        setChatMsgs(p=>[...p,{role:"assistant",content:parsed.변경요약||parsed.답변||raw.trim()}]);
      }
    }catch(e){
      setChatMsgs(p=>[...p,{role:"assistant",content:"⚠️ 오류: "+e.message,error:true}]);
    }
    setChatAttachedFiles([]);
    setChatLoading(false);
  };

  const handleUndo = () => {
    if(history.length===0) return;
    const prev = history[history.length-1];
    setResult(p=>({...p,항목:prev}));
    setHistory(h=>h.slice(0,-1));
    setChatMsgs(p=>[...p,{role:"assistant",content:"↶ 이전 단계로 되돌렸습니다."}]);
  };

  const handleChatFileAdd = async(files)=>{
    if(!files||files.length===0) return;
    setChatFileLoading(true);
    const newFiles=[];
    for(const file of Array.from(files)){
      const ext=(file.name.split(".").pop()||"").toLowerCase();
      if(ext==="hwp"){
        setToast("⚠️ HWP 파일은 첨부할 수 없습니다. PDF로 변환 후 업로드해주세요.");
        setTimeout(()=>setToast(""),4000);
        continue;
      }
      const processed = await processFile(file);
      newFiles.push(processed);
    }
    setChatAttachedFiles(p=>[...p,...newFiles]);
    setChatFileLoading(false);
  };

  const handleChatFileRemove = (idx)=>{
    setChatAttachedFiles(p=>p.filter((_,i)=>i!==idx));
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
                <span style={{fontSize:11,color:"#9ca3af",fontWeight:400,marginLeft:6}}>PDF · 이미지 · Word · TXT</span>
              </label>
              <input ref={fileRef} type="file" multiple
                accept=".pdf,.docx,.txt,.jpg,.jpeg,.png,.gif,.webp,.bmp"
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
              <div style={{marginTop:10,padding:"10px 14px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,fontSize:11.5,color:"#92400e",display:"flex",alignItems:"flex-start",gap:8}}>
                <span style={{fontSize:14,flexShrink:0}}>📋</span>
                <div>
                  <strong>한글파일(HWP)은 첨부할 수 없습니다.</strong>
                  <br/>
                  한글파일은 자체 구조상 AI가 내용을 읽을 수 없습니다. 아래 방법으로 변환 후 업로드해주세요.
                  <ul style={{margin:"6px 0 0 18px",padding:0,lineHeight:1.6}}>
                    <li><strong>방법 1.</strong> 한글에서 파일 → 다른 이름으로 저장 → 파일 형식 "PDF" 선택</li>
                    <li><strong>방법 2.</strong> 한글에서 파일 → PDF로 저장하기 (단축키 Alt+P)</li>
                    <li><strong>방법 3.</strong> 한글에서 파일 → 다른 이름으로 저장 → "MS워드 문서(*.docx)" 선택</li>
                  </ul>
                </div>
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
                <button className="bp" onClick={()=>handleSave("PDF")}>📋 PDF 저장</button>
                <button className="bp" onClick={()=>handleSave("인쇄")}>🖨️ 인쇄</button>
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
                  <button
                    onClick={handleUndo}
                    disabled={history.length===0}
                    style={{padding:"6px 12px",fontSize:12,border:"1px solid #1e3a5f",background:history.length===0?"#f3f4f6":"#fff",color:history.length===0?"#9ca3af":"#1e3a5f",borderRadius:6,cursor:history.length===0?"not-allowed":"pointer",fontWeight:600}}
                    title={history.length===0?"되돌릴 이전 상태가 없습니다":`${history.length}단계 전으로 돌아갑니다`}
                  >↶ 되돌리기{history.length>0?` (${history.length})`:""}</button>
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
                <div style={{marginBottom:8}}>
                  {chatAttachedFiles.length>0&&(
                    <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:6}}>
                      {chatAttachedFiles.map((f,i)=>(
                        <div key={i} style={{display:"flex",alignItems:"center",gap:6,background:"#f0fdf4",border:"1px solid #86efac",borderRadius:6,padding:"4px 8px",fontSize:11}}>
                          <span>{FILE_ICON(f)}</span>
                          <span>{f.name}</span>
                          <button onClick={()=>handleChatFileRemove(i)} style={{border:"none",background:"transparent",color:"#dc2626",cursor:"pointer",fontWeight:700,fontSize:14,padding:0}} title="제거">×</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <label style={{display:"inline-flex",alignItems:"center",gap:4,padding:"4px 10px",border:"1px dashed #1e3a5f",borderRadius:6,fontSize:11,color:"#1e3a5f",cursor:"pointer",background:"#fff"}}>
                    📎 {chatFileLoading?"파일 처리중...":"추가 자료 첨부"}
                    <input type="file" multiple accept=".pdf,.docx,.txt,.jpg,.jpeg,.png,.gif,.webp,.bmp" style={{display:"none"}} onChange={e=>{handleChatFileAdd(e.target.files);e.target.value="";}} disabled={chatFileLoading}/>
                  </label>
                  <span style={{fontSize:10,color:"#9ca3af",marginLeft:8}}>현장 사진 · 추가 시방서 등 첨부 가능 (HWP 제외)</span>
                </div>
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
