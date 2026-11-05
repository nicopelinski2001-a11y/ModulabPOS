import PDFDocument from 'pdfkit';

/** Bounded exports are built before sending; errors reach the global handler. */
export async function createPdf(title: string, rows: readonly string[]) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    info: { Title: title, Author: 'Modulab POS' },
  });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc.fontSize(17).text(title).moveDown();
  doc.fontSize(10);
  for (const row of rows)
    doc.text(row.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ')).moveDown(0.35);
  doc.end();
  return result;
}
