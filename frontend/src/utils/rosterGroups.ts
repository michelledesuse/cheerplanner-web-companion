import { STAFF_ROLES, type AthleteRole } from "@/src/utils/roles";

export type GridMember = {
  id: string;
  name: string;
  role: string;
  first_name?: string | null;
  last_name?: string | null;
  team_ids?: string[] | null;
};

export const isPersonnel = (role?: string | null): boolean =>
  STAFF_ROLES.includes((role || "") as AthleteRole);

const byName = (a: GridMember, b: GridMember) => {
  const al = (a.last_name || a.name || "").toLowerCase();
  const bl = (b.last_name || b.name || "").toLowerCase();
  if (al !== bl) return al.localeCompare(bl);
  return (a.first_name || "").toLowerCase().localeCompare((b.first_name || "").toLowerCase());
};

/** Filter by team, then split into Personnel + Athletes (each alpha-sorted). */
export function filterAndSplit(members: GridMember[], teamFilter: string | null) {
  const filtered = members.filter((m) => {
    const tids = m.team_ids || [];
    if (teamFilter === null) return true;
    if (teamFilter === "none") return tids.length === 0;
    return tids.includes(teamFilter);
  });
  const personnel = filtered.filter((m) => isPersonnel(m.role)).sort(byName);
  const athletes = filtered.filter((m) => !isPersonnel(m.role)).sort(byName);
  return { personnel, athletes, all: [...personnel, ...athletes] };
}

export type GridRow =
  | { kind: "section"; title: string; key: string }
  | { kind: "member"; member: GridMember; key: string; alt: boolean };

/** Build ordered rows with Personnel / Athletes section headers + zebra striping. */
export function buildGridRows(members: GridMember[], teamFilter: string | null): { rows: GridRow[]; total: number } {
  const { personnel, athletes, all } = filterAndSplit(members, teamFilter);
  const rows: GridRow[] = [];
  let mi = 0;
  const push = (title: string, list: GridMember[]) => {
    if (list.length === 0) return;
    rows.push({ kind: "section", title, key: `sec-${title}` });
    list.forEach((m) => {
      rows.push({ kind: "member", member: m, key: m.id, alt: mi % 2 === 1 });
      mi += 1;
    });
  };
  push("Personnel", personnel);
  push("Athletes", athletes);
  return { rows, total: all.length };
}
