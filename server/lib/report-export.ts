import { Buffer } from 'node:buffer';
import PDFDocument from 'pdfkit';
import { render as renderBidi } from 'bidi-shaper';
import { fileURLToPath } from 'node:url';

type Cell = string | number | null | undefined;

function xml(value: string): string {
  // XML 1.0 forbids these control characters; keep this targeted sanitization regex.
  // eslint-disable-next-line no-control-regex
  const validXmlText = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  return validXmlText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files: Array<{ name: string; content: string }>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.from(file.content, 'utf8');
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0x21, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    local.push(header, name, data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0, 8);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt16LE(0, 30);
    entry.writeUInt16LE(0, 32);
    entry.writeUInt16LE(0, 34);
    entry.writeUInt16LE(0, 36);
    entry.writeUInt32LE(0, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += header.length + name.length + data.length;
  }
  const centralData = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralData.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...local, centralData, end]);
}

function columnName(index: number): string {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

export function createReportXlsx(headers: string[], rows: Cell[][], title: string, subtitle: string): Buffer {
  const allRows: Cell[][] = [[title], [subtitle], [], headers, ...rows];
  const sheetRows = allRows.map((row, rowIndex) => {
    const cells = row.map((value, colIndex) => {
      const ref = `${columnName(colIndex)}${rowIndex + 1}`;
      if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
      if (value === null || value === undefined || value === '') return `<c r="${ref}"/>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(String(value))}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="${headers.length}" width="22" customWidth="1"/></cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A4:${columnName(Math.max(headers.length - 1, 0))}${allRows.length}"/></worksheet>`;
  return zipStore([
    { name: '[Content_Types].xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' },
    { name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Queue Report" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${sheet}` },
  ]);
}

const arabicFontPath = fileURLToPath(new URL('../../node_modules/@expo-google-fonts/noto-kufi-arabic/400Regular/NotoKufiArabic_400Regular.ttf', import.meta.url));
const arabicTextPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/u;

export function shapeArabicForPdf(value: string): string {
  return arabicTextPattern.test(value) ? renderBidi(value) : value;
}

function printableLatin(value: string): string {
  return value.normalize('NFKD').replace(/[^\x20-\x7E]/g, '?');
}

function drawPdfCell(
  doc: InstanceType<typeof PDFDocument>,
  value: string,
  x: number,
  y: number,
  width: number,
): void {
  const text = value.replace(/[\\r\\n]+/g, ' ').slice(0, 42);
  doc.fontSize(7);
  if (arabicTextPattern.test(text)) {
    doc.font('Arabic');
    // bidi-shaper's PDFKit declaration is narrower than PDFKit's overloaded text() signature.
    // Shape and reorder Unicode text before passing it to PDFKit. The
    // bidi-shaper PDFKit adapter supplies custom glyph IDs that can break
    // PDFKit's font subsetting for embedded WOFF2 fonts.
    doc.text(shapeArabicForPdf(text), x + 3, y, {
      width: Math.max(8, width - 6),
      height: 16,
      lineBreak: false,
      ellipsis: true,
      align: 'right',
    });
  } else {
    doc.font('Helvetica');
    doc.text(printableLatin(text), x + 3, y, {
      width: Math.max(8, width - 6),
      height: 16,
      lineBreak: false,
      ellipsis: true,
    });
  }
}

export async function createReportPdf(headers: string[], rows: Cell[][], title: string, subtitle: string): Promise<Buffer> {
  const pageRows = 22;
  const columnsPerPage = 5;
  const rowChunks = rows.length
    ? Array.from({ length: Math.ceil(rows.length / pageRows) }, (_, index) => rows.slice(index * pageRows, (index + 1) * pageRows))
    : [[]];
  const panels = Math.max(1, Math.ceil(headers.length / columnsPerPage));
  const totalPages = rowChunks.length * panels;
  const doc = new PDFDocument({ size: [842, 595], margin: 0, compress: false });
  const output: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => output.push(chunk));
  const completed = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(output)));
    doc.on('error', reject);
  });
  doc.registerFont('Arabic', arabicFontPath);

  let pageNumber = 0;
  for (const chunk of rowChunks) {
    for (let panel = 0; panel < panels; panel += 1) {
      if (pageNumber > 0) doc.addPage({ size: [842, 595], margin: 0 });
      pageNumber += 1;
      const firstColumn = panel * columnsPerPage;
      const lastColumn = Math.min(firstColumn + columnsPerPage, headers.length);
      const visibleHeaders = headers.slice(firstColumn, lastColumn);
      const columnWidth = 770 / Math.max(visibleHeaders.length, 1);

      doc.fillColor('#1f2e48').font('Helvetica').fontSize(16)
        .text(printableLatin(title), 36, 30, { lineBreak: false });
      doc.fillColor('#596373').fontSize(9)
        .text(printableLatin(subtitle), 36, 54, { lineBreak: false });
      doc.fontSize(8)
        .text('Columns ' + (firstColumn + 1) + '-' + lastColumn + ' of ' + headers.length, 36, 72, { lineBreak: false });
      doc.fillColor('#e9edf2').rect(36, 94, 770, 20).fill();
      doc.fillColor('#1f2e48');
      visibleHeaders.forEach((header, index) => {
        const x = 36 + index * columnWidth;
        doc.font('Helvetica').fontSize(8).text(printableLatin(header.slice(0, 32)), x + 3, 100, {
          width: Math.max(8, columnWidth - 6), height: 12, lineBreak: false, ellipsis: true,
        });
      });
      chunk.forEach((row, rowIndex) => {
        const y = 118 + rowIndex * 19;
        if (rowIndex % 2 === 1) doc.fillColor('#f7f8fa').rect(36, y - 3, 770, 18).fill();
        doc.fillColor('#1f2e48');
        visibleHeaders.forEach((_, columnIndex) => {
          const x = 36 + columnIndex * columnWidth;
          drawPdfCell(doc, String(row[firstColumn + columnIndex] ?? ''), x, y, columnWidth);
        });
      });
      doc.strokeColor('#8c96a5').moveTo(36, 560).lineTo(806, 560).stroke();
      doc.fillColor('#596373').font('Helvetica').fontSize(8)
        .text('Page ' + pageNumber + ' of ' + totalPages, 690, 570, {
          width: 116, align: 'right', lineBreak: false,
        });
    }
  }
  doc.end();
  return completed;
}
