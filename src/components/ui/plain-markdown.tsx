import type { ReactNode } from "react";

/**
 * Renders the small subset of Markdown a model summary uses — headings, bullet and numbered lists,
 * **bold** and *italic* — as React elements. Nothing is injected as HTML, so text taken from a
 * scraped page cannot become markup, and links are left as plain text.
 */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|__(.+?)__|\*(?!\s)(.+?)\*|`([^`]+)`/g;
  let last = 0; let m: RegExpExecArray | null; let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] ?? m[2]) out.push(<strong key={i++}>{m[1] ?? m[2]}</strong>);
    else if (m[3]) out.push(<em key={i++}>{m[3]}</em>);
    else out.push(<code key={i++} className="text-xs">{m[4]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function PlainMarkdown({ text, className = "" }: { text: string; className?: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length} className="list-decimal space-y-1 pl-5">{items}</ol> : <ul key={blocks.length} className="list-disc space-y-1 pl-5">{items}</ul>);
    list = null;
  };
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line); const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flush();
      list = list ?? { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    blocks.push(heading ? <p key={blocks.length} className="font-semibold">{inline(heading[1])}</p> : <p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <div className={`space-y-2 ${className}`}>{blocks}</div>;
}
