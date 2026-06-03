// Date format: DD-MM-YYYY for display; storage stays ISO YYYY-MM-DD for sortability.

export function formatCurrency(value: number | null | undefined): string {
  const n = typeof value === "number" ? value : 0;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Accepts ISO `YYYY-MM-DD`, full ISO datetime, or already-formatted strings. Outputs DD-MM-YYYY. */
export function formatDate(iso: string | null | undefined, opts?: { withYear?: boolean }): string {
  if (!iso) return "—";
  try {
    const s = iso.length === 10 ? `${iso}T00:00:00` : iso;
    const d = new Date(s);
    if (isNaN(d.getTime())) return iso;
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
  } catch {
    return iso;
  }
}

/** Outputs e.g. "Mon, 13-11-2025". */
export function formatDateLong(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const s = iso.length === 10 ? `${iso}T00:00:00` : iso;
    const d = new Date(s);
    if (isNaN(d.getTime())) return iso;
    const weekday = d.toLocaleDateString("en-US", { weekday: "short" });
    return `${weekday}, ${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
  } catch {
    return iso;
  }
}

/** Today as ISO YYYY-MM-DD (for storage). */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Today as DD-MM-YYYY (for showing in input fields). */
export function todayDisplay(): string {
  const d = new Date();
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** Convert a stored YYYY-MM-DD (or ISO datetime) into DD-MM-YYYY for prefilling inputs. */
export function isoToInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return String(iso);
}

/**
 * Parse a user-typed date string into ISO YYYY-MM-DD (for storage).
 * Accepts: DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD, MM/DD/YYYY (auto-detected).
 * Returns null if blank, throws if unparseable.
 */
export function userDateToISO(input: string | null | undefined): string | null {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;

  // Already ISO
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return s;

  // DD-MM-YYYY or DD/MM/YYYY
  const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmy) {
    const d = parseInt(dmy[1], 10);
    const m = parseInt(dmy[2], 10);
    const y = parseInt(dmy[3], 10);
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
  throw new Error(`Invalid date: "${s}". Use DD-MM-YYYY.`);
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
