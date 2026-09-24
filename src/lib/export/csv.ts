/**
 * CSV cells, quoted, with spreadsheet formula injection neutralised: a cell that
 * begins with = + - @ tab or CR is prefixed with ' so a spreadsheet shows it as
 * text instead of running it. Rows end CRLF, as RFC 4180 and Excel expect.
 */
export function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
