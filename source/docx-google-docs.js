import JSZip from "jszip";

const DEFAULT_TITLE = "기후 타임캡슐 문서";

function decodeXmlText(value) {
  return String(value ?? "")
    .replace(/&#x([0-9a-f]+);/giu, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/&#([0-9]+);/gu, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 10)))
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, "\"")
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function extractParagraphText(xml) {
  const parts = [];
  const tokenPattern = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br)\b[^>]*\/?\s*>/gu;
  for (const match of String(xml ?? "").matchAll(tokenPattern)) {
    if (match[1] !== undefined) {
      parts.push(decodeXmlText(match[1]));
    } else {
      parts.push(match[2] === "tab" ? "\t" : "\n");
    }
  }
  return parts.join("").trim();
}

function renderParagraph(xml) {
  const text = extractParagraphText(xml);
  if (!text) return "";
  const content = escapeHtml(text).replace(/\n/gu, "<br>");
  if (/<w:pStyle\b[^>]*w:val="Heading[1-3]"/u.test(xml)) {
    return `<h2>${content}</h2>`;
  }
  if (/<w:numPr\b/u.test(xml)) {
    return `<p class="list-item">${content}</p>`;
  }
  return `<p>${content}</p>`;
}

function renderTable(xml) {
  const rows = [...String(xml ?? "").matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/gu)];
  if (rows.length === 0) return "";
  const body = rows.map((rowMatch, rowIndex) => {
    const rowXml = rowMatch[0];
    const header = rowIndex === 0 || /<w:tblHeader\b/u.test(rowXml);
    const cellTag = header ? "th" : "td";
    const cells = [...rowXml.matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/gu)].map((cellMatch) => {
      const paragraphs = [...cellMatch[0].matchAll(/<w:p\b[\s\S]*?<\/w:p>/gu)]
        .map((paragraphMatch) => extractParagraphText(paragraphMatch[0]))
        .filter(Boolean)
        .map(escapeHtml);
      return `<${cellTag}>${paragraphs.join("<br>") || "&nbsp;"}</${cellTag}>`;
    }).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
  return `<table>${body}</table>`;
}

function renderDocumentBody(documentXml) {
  const bodyXml = documentXml.match(/<w:body\b[^>]*>([\s\S]*?)<\/w:body>/u)?.[1];
  if (!bodyXml) {
    throw new Error("Google 문서용 파일을 만들 수 있도록 DOCX 본문을 읽지 못했습니다.");
  }
  return [...bodyXml.matchAll(/<w:(p|tbl)\b[\s\S]*?<\/w:\1>/gu)]
    .map((match) => match[1] === "tbl" ? renderTable(match[0]) : renderParagraph(match[0]))
    .filter(Boolean)
    .join("\n");
}

function wrapGoogleDocsHtml(content, title) {
  const safeTitle = escapeHtml(title || DEFAULT_TITLE);
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
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
${content}
<footer>기후 타임캡슐에서 만든 Google 문서 가져오기용 파일입니다.</footer>
</body>
</html>`;
}

export async function buildGoogleDocsImportHtml(docxBlob, { title = DEFAULT_TITLE } = {}) {
  if (!docxBlob || typeof docxBlob.arrayBuffer !== "function") {
    throw new TypeError("Google 문서용 파일을 만들려면 DOCX 원본이 필요합니다.");
  }
  const archive = await JSZip.loadAsync(await docxBlob.arrayBuffer());
  const documentEntry = archive.file("word/document.xml");
  if (!documentEntry) {
    throw new Error("Google 문서용 파일을 만들 수 있도록 DOCX 본문을 찾지 못했습니다.");
  }
  const documentXml = await documentEntry.async("string");
  const html = wrapGoogleDocsHtml(renderDocumentBody(documentXml), title);
  return new Blob([html], { type: "text/html;charset=utf-8" });
}
