export function formatCurrency(value: number | null | undefined): string {
  const n = typeof value === "number" ? value : 0;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

export function formatDate(iso: string | null | undefined, opts?: { withYear?: boolean }): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: opts?.withYear ? "numeric" : undefined,
    });
  } catch {
    return iso;
  }
}

export function formatDateLong(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
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
