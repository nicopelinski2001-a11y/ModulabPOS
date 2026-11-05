/** Spreadsheet-safe, UTF-8 BOM CSV with exact caller-provided decimal strings. */
export function serializeCsv(rows: unknown[][]) {
  return (
    '\ufeff' +
    rows
      .map((row) =>
        row
          .map((value) => {
            let text = String(value ?? '');
            if (/^\s*[=+@-]/.test(text)) text = `'${text}`;
            return `"${text.replaceAll('"', '""')}"`;
          })
          .join(';'),
      )
      .join('\r\n')
  );
}
