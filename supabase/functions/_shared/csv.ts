// CSV for the lead export (slice 5.2). RFC 4180 quoting, CRLF line ends, and spreadsheet-formula neutralised: a cell that starts with = + - @ (or a
// tab or carriage return, which some programs also treat as a formula start) gets a leading quote, so a lead who typed =HYPERLINK(...) as their name
// opens as text, not as a formula (OWASP CSV injection).
export function csvCell(v: unknown): string {
  let s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export const csvLine = (cells: unknown[]): string => cells.map(csvCell).join(',') + '\r\n';
