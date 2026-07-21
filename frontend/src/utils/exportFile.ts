import { Platform } from "react-native";
import * as XLSX from "xlsx";

export type ExportFormat = "csv" | "xlsx";

const CSV_MIME = "text/csv;charset=utf-8";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type Cell = string | number | null | undefined;

const csvEscape = (v: Cell) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function webDownload(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function saveNative(filename: string, data: string, base64: boolean, mime: string) {
  const FS: any = await import("expo-file-system/legacy");
  const Sharing: any = await import("expo-sharing");
  const uri = `${FS.cacheDirectory}${filename}`;
  await FS.writeAsStringAsync(uri, data, { encoding: base64 ? FS.EncodingType.Base64 : FS.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: mime, dialogTitle: "Export" });
  }
  return uri;
}

async function saveCsv(baseName: string, csv: string) {
  const filename = `${baseName}.csv`;
  if (Platform.OS === "web") webDownload(filename, new Blob([csv], { type: CSV_MIME }));
  else await saveNative(filename, csv, false, "text/csv");
  return filename;
}

async function saveWorkbook(baseName: string, wb: XLSX.WorkBook) {
  const filename = `${baseName}.xlsx`;
  if (Platform.OS === "web") {
    const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    webDownload(filename, new Blob([out], { type: XLSX_MIME }));
  } else {
    const b64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
    await saveNative(filename, b64, true, XLSX_MIME);
  }
  return filename;
}

/** Export a 2D array (rows of cells) as CSV or XLSX. */
export async function exportAoa(baseName: string, aoa: Cell[][], format: ExportFormat, sheetName = "Sheet1") {
  if (format === "csv") {
    const csv = aoa.map((row) => row.map(csvEscape).join(",")).join("\n");
    return saveCsv(baseName, csv);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa.map((r) => r.map((c) => (c == null ? "" : c))));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  return saveWorkbook(baseName, wb);
}

/** Export an existing CSV string as CSV (passthrough) or converted XLSX. */
export async function exportCsvString(baseName: string, csv: string, format: ExportFormat, sheetName = "Sheet1") {
  if (format === "csv") return saveCsv(baseName, csv);
  const ws = XLSX.utils.aoa_to_sheet(
    csv.split(/\r?\n/).map((line) => {
      // Minimal CSV parse that respects quoted fields.
      const out: string[] = [];
      let cur = "";
      let q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (q) {
          if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
          else if (ch === '"') q = false;
          else cur += ch;
        } else if (ch === '"') q = true;
        else if (ch === ",") { out.push(cur); cur = ""; }
        else cur += ch;
      }
      out.push(cur);
      return out;
    })
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  return saveWorkbook(baseName, wb);
}
