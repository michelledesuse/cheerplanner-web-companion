export const SCOUT_CATEGORIES: { key: string; label: string; icon: string }[] = [
  { key: "tumbling", label: "Tumbling", icon: "sync-outline" },
  { key: "stunting", label: "Stunting", icon: "people-outline" },
  { key: "jumps", label: "Jumps", icon: "arrow-up-outline" },
];

export const SCOUT_LEVELS: { key: string; label: string; color: string; desc: string }[] = [
  { key: "on_deck", label: "On Deck", color: "#94A3B8", desc: "On the goal sheet — physical training hasn't begun." },
  { key: "spotted", label: "Spotted", color: "#F59E0B", desc: "Learning with a spot, harness, or mats." },
  { key: "unassisted", label: "Unassisted", color: "#3B82F6", desc: "Performs independently, still building consistency." },
  { key: "routine_ready", label: "Routine Ready", color: "#8B5CF6", desc: "Solid & legal — ready for a full-out." },
  { key: "hit_zero", label: "Hit Zero", color: "#10B981", desc: "Flawless & consistent under pressure." },
];

export function levelMeta(key?: string | null) {
  return SCOUT_LEVELS.find((l) => l.key === key) || null;
}

export function catLabel(key?: string | null) {
  return SCOUT_CATEGORIES.find((c) => c.key === key)?.label || key || "";
}
