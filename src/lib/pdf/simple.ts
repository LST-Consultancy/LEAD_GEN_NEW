/**
 * A small PDF 1.4 writer for text documents: headings, paragraphs and key-value lines on A4,
 * wrapped with the real Helvetica glyph widths and paginated. Pure; no dependency. The two
 * standard fonts need no embedding, and text is WinAnsi-encoded (Latin-1 accents and symbols stay) —
 * a character outside it (₹, CJK) is written as its closest ASCII form rather than corrupting the file.
 */
export type Block = { kind: "title" | "heading" | "text" | "muted"; text: string };

// Helvetica advance widths (per 1000 em) for ASCII 32–126, from the standard AFM.
const W = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const width = (s: string, size: number, bold: boolean) => [...s].reduce((n, ch) => { const c = ch.charCodeAt(0); return n + (c >= 32 && c <= 126 ? W[c - 32] : 556); }, 0) * size / 1000 * (bold ? 1.08 : 1);

/** Characters the standard fonts cannot show, written readably instead. */
export function toWinAnsi(s: string) {
  return s.replace(/₹/g, "Rs. ").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...").replace(/•/g, "-").replace(/[ ]/g, " ")
    // WinAnsi matches Latin-1 from 0xA1 to 0xFF (é, ·, ©), so those stay; anything beyond is decomposed or marked.
    .normalize("NFC").replace(/[^\x20-\x7e\xa1-\xff\n]/g, ch => { const base = ch.normalize("NFKD").replace(/[̀-ͯ]/g, ""); return /^[\x20-\x7e]+$/.test(base) ? base : "?"; });
}
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

function wrap(text: string, size: number, bold: boolean, max: number) {
  const out: string[] = [];
  for (const para of toWinAnsi(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (width(next, size, bold) <= max) { line = next; continue; }
      if (line) out.push(line);
      // A single word longer than the line is broken hard rather than overflowing.
      let w = word;
      while (width(w, size, bold) > max) { let i = w.length; while (i > 1 && width(w.slice(0, i), size, bold) > max) i--; out.push(w.slice(0, i)); w = w.slice(i); }
      line = w;
    }
    out.push(line);
  }
  return out;
}

const STYLE: Record<Block["kind"], { size: number; bold: boolean; gapBefore: number; grey: boolean }> = {
  title: { size: 18, bold: true, gapBefore: 0, grey: false },
  heading: { size: 10, bold: true, gapBefore: 14, grey: true },
  text: { size: 10, bold: false, gapBefore: 4, grey: false },
  muted: { size: 8.5, bold: false, gapBefore: 3, grey: true },
};

export function renderPdf(blocks: Block[], meta: { title: string; footer?: string } = { title: "Document" }): Buffer {
  const PAGE_W = 595.28, PAGE_H = 841.89, M = 56, MAX = PAGE_W - 2 * M;
  const pages: string[][] = [[]];
  let y = PAGE_H - M;
  const newPage = () => { pages.push([]); y = PAGE_H - M; };
  for (const b of blocks) {
    const st = STYLE[b.kind]; const lead = st.size * 1.35;
    y -= st.gapBefore;
    for (const line of wrap(b.text, st.size, st.bold, MAX)) {
      if (y - lead < M + 20) newPage();
      y -= lead;
      pages.at(-1)!.push(`BT /${st.bold ? "F2" : "F1"} ${st.size} Tf ${st.grey ? "0.4 0.4 0.4 rg" : "0.1 0.1 0.1 rg"} ${M} ${y.toFixed(2)} Td (${esc(line)}) Tj ET`);
    }
  }
  const objs: string[] = [];
  const add = (s: string) => { objs.push(s); return objs.length; };
  const catalog = add("");
  const pagesObj = add("");
  const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const kids: number[] = [];
  pages.forEach((ops, i) => {
    const footer = `BT /F1 8 Tf 0.5 0.5 0.5 rg ${M} 30 Td (${esc(toWinAnsi(`${meta.footer ? `${meta.footer} · ` : ""}Page ${i + 1} of ${pages.length}`))}) Tj ET`;
    const stream = [...ops, footer].join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`));
  });
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  const info = add(`<< /Title (${esc(toWinAnsi(meta.title))}) /Producer (Signalroom) >>`);
  let body = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(body, "latin1")); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
