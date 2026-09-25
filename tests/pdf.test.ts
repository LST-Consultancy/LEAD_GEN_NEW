import { describe, expect, it } from "vitest";
import { renderPdf, toWinAnsi } from "@/lib/pdf/simple";

const parse = (buf: Buffer) => buf.toString("latin1");

describe("the PDF writer", () => {
  it("writes a structurally valid file whose cross-reference offsets point at their objects", () => {
    const pdf = parse(renderPdf([{ kind: "title", text: "Meera (Synthetic)" }, { kind: "text", text: "Back\\slash and ₹5,00,000 — “quotes”" }], { title: "Dossier" }));
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    const xrefAt = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    expect(pdf.slice(xrefAt, xrefAt + 4)).toBe("xref");
    const offsets = [...pdf.slice(xrefAt).matchAll(/(\d{10}) 00000 n /g)].map(m => Number(m[1]));
    offsets.forEach((o, i) => expect(pdf.slice(o).startsWith(`${i + 1} 0 obj`)).toBe(true));
    expect(pdf).toContain("(Meera \\(Synthetic\\)) Tj");
    expect(pdf).toContain("Back\\\\slash and Rs. 5,00,000 - \\\"quotes\\\"".replace(/\\"/g, '"'));
  });
  it("paginates long content and numbers the pages", () => {
    const pdf = parse(renderPdf(Array.from({ length: 120 }, (_, i) => ({ kind: "text" as const, text: `Line ${i} with enough words to fill part of a line on the page.` }))));
    const pages = Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(pdf)![1]);
    expect(pages).toBeGreaterThan(1);
    expect(pdf).toContain(`Page ${pages} of ${pages}`);
  });
  it("replaces characters the standard fonts cannot show instead of corrupting the file", () => {
    expect(toWinAnsi("Café · ₹10 – 日本 ǅ")).toBe("Café · Rs. 10 - ?? Dz");
  });
});
