import { serializeCsv } from '../shared/csv';
/** Excel-compatible CSV; neutralize spreadsheet formulas on export. */
export function downloadCsv(filename: string, rows: unknown[][]) {
  const data = serializeCsv(rows);
  const url = URL.createObjectURL(new Blob([data], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function parseCsv(source: string): string[][] {
  if (source.length > 1_000_000) throw new Error('El archivo supera 1 MB.');
  const value = source.replace(/^\uFEFF/, '');
  const first = value.split(/\r?\n/)[0] ?? '';
  const delimiter = first.includes(';') ? ';' : first.includes('\t') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '"') {
      if (quoted && value[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted) {
        quoted = false;
      } else if (cell === '') {
        quoted = true;
      } else throw new Error('CSV inválido: comillas dentro de un campo.');
    } else if (c === delimiter && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && value[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (quoted) throw new Error('CSV inválido: falta cerrar comillas.');
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
