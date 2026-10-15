// Общ стил и помощни функции за Word документите на проекта
// (архитектурна стратегия, документ за клиенти). Един стил навсякъде.
const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, ShadingType, AlignmentType, LevelFormat, BorderStyle, Footer, PageNumber,
} = require("docx");

const NAVY = "1F3864";
const ACCENT = "2E75B6";
const LIGHT = "DEEAF6";
const WARN = "FFF2CC";
const TABLE_W = 9638; // A4 минус 2 × 1134 полета

/** Поддържа **удебелен** текст в реда. */
function runs(text) {
  return text.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((t) =>
    t.startsWith("**") ? new TextRun({ text: t.slice(2, -2), bold: true }) : new TextRun(t)
  );
}

const p = (text, opts = {}) => new Paragraph({ spacing: { after: 120 }, ...opts, children: runs(text) });
const h1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const h2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const bullet = (t, level = 0) =>
  new Paragraph({ numbering: { reference: "bullets", level }, spacing: { after: 60 }, children: runs(t) });
const num = (t, ref = "nums") =>
  new Paragraph({ numbering: { reference: ref, level: 0 }, spacing: { after: 60 }, children: runs(t) });
const gap = () => new Paragraph({ spacing: { after: 120 }, children: [] });

function note(text, fill = LIGHT, border = ACCENT) {
  return new Table({
    width: { size: TABLE_W, type: WidthType.DXA },
    columnWidths: [TABLE_W],
    rows: [new TableRow({ children: [new TableCell({
      width: { size: TABLE_W, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill, color: "auto" },
      margins: { top: 120, bottom: 120, left: 160, right: 160 },
      borders: { left: { style: BorderStyle.SINGLE, size: 24, color: border },
        top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
      children: [new Paragraph({ children: runs(text) })],
    })] })],
  });
}

function table(headers, rows, widths) {
  const total = widths.reduce((a, b) => a + b, 0);
  const cell = (t, isHead, w) => new TableCell({
    width: { size: w, type: WidthType.DXA },
    shading: isHead ? { type: ShadingType.CLEAR, fill: NAVY, color: "auto" } : undefined,
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    children: [new Paragraph({ children: isHead
      ? [new TextRun({ text: t, bold: true, color: "FFFFFF" })]
      : runs(t) })],
  });
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, true, widths[i])) }),
      ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, false, widths[i])) })),
    ],
  });
}

/** Сглобява документа с общия стил и го записва в outPath. */
function writeDocument({ outPath, title, footerText, children, updateFields = false }) {
  const doc = new Document({
    creator: "Claude (Senior AI Architect)",
    title,
    ...(updateFields && { features: { updateFields: true } }),
    styles: {
      default: { document: { run: { font: "Calibri", size: 22 } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 32, bold: true, color: NAVY }, paragraph: { spacing: { before: 360, after: 160 }, outlineLevel: 0, keepNext: true, keepLines: true } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 26, bold: true, color: ACCENT }, paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1, keepNext: true, keepLines: true } },
      ],
    },
    numbering: { config: [
      { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "nums", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ] },
    sections: [{
      properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: `${footerText} · стр. `, color: "808080", size: 18 }),
          new TextRun({ children: [PageNumber.CURRENT], color: "808080", size: 18 })] })] }) },
      children,
    }],
  });
  return Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(outPath, buf); console.log("written", outPath); });
}

function requireOutPath() {
  const out = process.argv[2];
  if (!out) {
    console.error("Липсва път за изходния файл (.docx).");
    process.exit(1);
  }
  return out;
}

module.exports = {
  NAVY, ACCENT, LIGHT, WARN, TABLE_W,
  runs, p, h1, h2, bullet, num, gap, note, table, writeDocument, requireOutPath,
};
