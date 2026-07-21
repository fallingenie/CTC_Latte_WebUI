import{J as m}from"./jszip.min-DkUyrEX8.js";import"./_commonjsHelpers-Cpj98o6Y.js";const c="기후 타임캡슐 문서";function g(t){return String(t??"").replace(/&#x([0-9a-f]+);/giu,(e,r)=>String.fromCodePoint(Number.parseInt(r,16))).replace(/&#([0-9]+);/gu,(e,r)=>String.fromCodePoint(Number.parseInt(r,10))).replace(/&lt;/gu,"<").replace(/&gt;/gu,">").replace(/&quot;/gu,'"').replace(/&apos;/gu,"'").replace(/&amp;/gu,"&")}function l(t){return String(t??"").replace(/&/gu,"&amp;").replace(/</gu,"&lt;").replace(/>/gu,"&gt;").replace(/"/gu,"&quot;").replace(/'/gu,"&#39;")}function s(t){const e=[],r=/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br)\b[^>]*\/?\s*>/gu;for(const o of String(t??"").matchAll(r))o[1]!==void 0?e.push(g(o[1])):e.push(o[2]==="tab"?"	":`
`);return e.join("").trim()}function f(t){const e=s(t);if(!e)return"";const r=l(e).replace(/\n/gu,"<br>");return/<w:pStyle\b[^>]*w:val="Heading[1-3]"/u.test(t)?`<h2>${r}</h2>`:/<w:numPr\b/u.test(t)?`<p class="list-item">${r}</p>`:`<p>${r}</p>`}function b(t){const e=[...String(t??"").matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/gu)];return e.length===0?"":`<table>${e.map((o,a)=>{const n=o[0],i=a===0||/<w:tblHeader\b/u.test(n)?"th":"td";return`<tr>${[...n.matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/gu)].map(p=>{const u=[...p[0].matchAll(/<w:p\b[\s\S]*?<\/w:p>/gu)].map(d=>s(d[0])).filter(Boolean).map(l);return`<${i}>${u.join("<br>")||"&nbsp;"}</${i}>`}).join("")}</tr>`}).join("")}</table>`}function h(t){const e=t.match(/<w:body\b[^>]*>([\s\S]*?)<\/w:body>/u)?.[1];if(!e)throw new Error("Google 문서용 파일을 만들 수 있도록 DOCX 본문을 읽지 못했습니다.");return[...e.matchAll(/<w:(p|tbl)\b[\s\S]*?<\/w:\1>/gu)].map(r=>r[1]==="tbl"?b(r[0]):f(r[0])).filter(Boolean).join(`
`)}function w(t,e){return`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${l(e||c)}</title>
  <style>
    body { color: #14211c; font-family: "Malgun Gothic", "Noto Sans KR", sans-serif; line-height: 1.6; margin: 0 auto; max-width: 860px; padding: 40px; }
    h2 { color: #126b52; font-size: 1.35rem; margin: 2rem 0 0.75rem; }
    p { margin: 0 0 0.75rem; }
    .list-item { padding-left: 1.25rem; position: relative; }
    .list-item::before { content: "•"; left: 0; position: absolute; }
    table { border-collapse: collapse; margin: 1rem 0 1.5rem; table-layout: fixed; width: 100%; }
    th, td { border: 1px solid #cbd9d3; padding: 0.6rem 0.75rem; text-align: left; vertical-align: top; word-break: keep-all; }
    th { background: #126b52; color: #fff; }
    tr:nth-child(even) td { background: #f5f8f7; }
    footer { border-top: 1px solid #cbd9d3; color: #5a6b64; font-size: 0.85rem; margin-top: 2.5rem; padding-top: 1rem; }
    @media (max-width: 640px) { body { padding: 20px; } th, td { padding: 0.5rem; } }
  </style>
</head>
<body>
${t}
<footer>기후 타임캡슐에서 만든 Google 문서 가져오기용 파일입니다.</footer>
</body>
</html>`}async function $(t,{title:e=c}={}){if(!t||typeof t.arrayBuffer!="function")throw new TypeError("Google 문서용 파일을 만들려면 DOCX 원본이 필요합니다.");const o=(await m.loadAsync(await t.arrayBuffer())).file("word/document.xml");if(!o)throw new Error("Google 문서용 파일을 만들 수 있도록 DOCX 본문을 찾지 못했습니다.");const a=await o.async("string"),n=w(h(a),e);return new Blob([n],{type:"text/html;charset=utf-8"})}export{$ as buildGoogleDocsImportHtml};
