"use client";

/** Opens the browser's print dialog, where "Save as PDF" produces the file. */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-primary print:hidden">
      Print or save as PDF
    </button>
  );
}
