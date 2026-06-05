// Date format: MM-DD-YYYY for display; storage stays ISO YYYY-MM-DD for sortability.

export function formatCurrency(value: number | null | undefined): string {
  const n = typeof value === "number" ? value : 0;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Accepts ISO `YYYY-MM-DD`, full ISO/legacy datetime, or already-formatted strings. Outputs MM-DD-YYYY. */
export function formatDate(iso: string | null | undefined, _opts?: { withYear?: boolean }): string {
  if (!iso) return "—";
  const datePart = pickDatePart(String(iso));
  if (!datePart) return String(iso);
  return `${pad(datePart.m)}-${pad(datePart.d)}-${datePart.y}`;
}

/** Outputs e.g. "Mon, 11-13-2025". */
export function formatDateLong(iso: string | null | undefined): string {
  if (!iso) return "—";
  const datePart = pickDatePart(String(iso));
  if (!datePart) return String(iso);
  const dt = new Date(`${datePart.y}-${pad(datePart.m)}-${pad(datePart.d)}T00:00:00`);
  const weekday = dt.toLocaleDateString("en-US", { weekday: "short" });
  return `${weekday}, ${pad(datePart.m)}-${pad(datePart.d)}-${datePart.y}`;
}

/** Today as ISO YYYY-MM-DD (for storage). */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Today as MM-DD-YYYY (for showing in input fields). */
export function todayDisplay(): string {
  const d = new Date();
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${d.getFullYear()}`;
}

/** Convert a stored YYYY-MM-DD (or ISO datetime) into MM-DD-YYYY for prefilling inputs. */
export function isoToInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const datePart = pickDatePart(String(iso));
  if (!datePart) return String(iso);
  return `${pad(datePart.m)}-${pad(datePart.d)}-${datePart.y}`;
}

/**
 * Parse a user-typed date string into ISO YYYY-MM-DD (for storage).
 * Accepts: MM-DD-YYYY, MM/DD/YYYY (US-first), YYYY-MM-DD, DD-MM-YYYY (auto-detected when month > 12).
 * Returns null if blank, throws if unparseable.
 */
export function userDateToISO(input: string | null | undefined): string | null {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;

  // Already ISO
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return s;

  // MM-DD-YYYY / MM/DD/YYYY (US default).
  const mdY = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (mdY) {
    let m = parseInt(mdY[1], 10);
    let d = parseInt(mdY[2], 10);
    const y = parseInt(mdY[3], 10);
    // If the "month" slot is > 12 it must be DD-MM-YYYY; swap.
    if (m > 12 && d <= 12) { const t = m; m = d; d = t; }
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      return `${y}-${pad(m)}-${pad(d)}`;
    }
  }

  // YYYY/MM/DD
  const ymd = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (ymd) {
    return `${ymd[1]}-${pad(+ymd[2])}-${pad(+ymd[3])}`;
  }

  // Fallback: let Date parse it
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  throw new Error(`Invalid date: "${s}". Use MM-DD-YYYY.`);
}

export function daysBetween(iso: string | null | undefined): number | null {
  if (!iso) return null;
  try {
    const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    d.setHours(0, 0, 0, 0);
    return Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

export function urgencyLevel(days: number | null): "overdue" | "soon" | "upcoming" | "future" {
  if (days === null) return "future";
  if (days < 0) return "overdue";
  if (days <= 3) return "soon";
  if (days <= 7) return "upcoming";
  return "future";
}

// ===== Time / DateTime helpers =====

/** Convert "HH:mm" (24h) to "h:mm AM/PM". Pass-through unknown values. */
export function formatTime12(hhmm: string | null | undefined): string {
  if (!hhmm) return "";
  const s = String(hhmm).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return s;
  let h = parseInt(m[1], 10);
  const min = m[2];
  if (isNaN(h)) return s;
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${period}`;
}

/**
 * Storage format for a combined date+time is `YYYY-MM-DD HH:mm` (ISO date + 24h time).
 * For backwards compatibility we also accept the legacy `DD-MM-YYYY HH:mm` / `MM-DD-YYYY HH:mm`.
 * Returns MM-DD-YYYY h:mm AM/PM for display.
 */
export function formatDateTime12(value: string | null | undefined): string {
  if (!value) return "—";
  const { datePart, timePart } = splitDateTime(String(value));
  const dateStr = datePart ? `${pad(datePart.m)}-${pad(datePart.d)}-${datePart.y}` : "";
  const timeStr = formatTime12(timePart);
  if (dateStr && timeStr) return `${dateStr} ${timeStr}`;
  return dateStr || timeStr || String(value);
}

/** Build a combined storage string from an ISO date (YYYY-MM-DD) and 24h time (HH:mm). */
export function combineDateTime(isoDate: string, hhmm: string): string {
  const d = (isoDate || "").trim();
  const t = (hhmm || "").trim();
  if (d && t) return `${d} ${t}`;
  return d || t || "";
}

/** Pull the {date, time} parts out of a stored combined string. */
export function splitDateTime(value: string | null | undefined): { isoDate: string; hhmm: string; datePart: DateParts | null; timePart: string } {
  const raw = (value || "").trim();
  if (!raw) return { isoDate: "", hhmm: "", datePart: null, timePart: "" };

  // Pull out HH:mm if present anywhere in the string.
  const tm = raw.match(/(\d{1,2}):(\d{2})/);
  const hhmm = tm ? `${pad(parseInt(tm[1], 10))}:${tm[2]}` : "";

  // Strip the time portion and any trailing AM/PM, then parse what's left as a date.
  let dateStr = raw;
  if (tm) {
    dateStr = raw.replace(/\s*\d{1,2}:\d{2}\s*(am|pm)?/i, "").trim();
  }

  const datePart = pickDatePart(dateStr);
  const isoDate = datePart ? `${datePart.y}-${pad(datePart.m)}-${pad(datePart.d)}` : "";
  return { isoDate, hhmm, datePart, timePart: hhmm };
}

type DateParts = { y: number; m: number; d: number };

/** Best-effort extraction of {y,m,d} from any reasonable input format. */
function pickDatePart(input: string): DateParts | null {
  const s = (input || "").trim();
  if (!s) return null;

  // ISO YYYY-MM-DD (anywhere at start)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { y: +iso[1], m: +iso[2], d: +iso[3] };

  // MM-DD-YYYY or MM/DD/YYYY (US-first), but flip to DD-MM-YYYY if first slot > 12.
  const mdY = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (mdY) {
    let m = +mdY[1], d = +mdY[2]; const y = +mdY[3];
    if (m > 12 && d <= 12) { const t = m; m = d; d = t; }
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) return { y, m, d };
  }

  // YYYY/MM/DD
  const y4 = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (y4) return { y: +y4[1], m: +y4[2], d: +y4[3] };

  // Fallback to Date()
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() };
  return null;
}
