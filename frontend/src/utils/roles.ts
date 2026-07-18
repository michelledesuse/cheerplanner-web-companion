import { Ionicons } from "@expo/vector-icons";

export type AthleteRole = "athlete" | "coach" | "team_rep" | "staff";

type RoleMeta = {
  value: AthleteRole;
  label: string; // full label for selectors
  short: string; // compact label for badges/meta
  icon: keyof typeof Ionicons.glyphMap;
};

export const ROLES: RoleMeta[] = [
  { value: "athlete", label: "Athlete", short: "Athlete", icon: "barbell-outline" },
  { value: "coach", label: "Coach", short: "Coach", icon: "megaphone-outline" },
  { value: "team_rep", label: "Team Rep/Mgr", short: "Team Rep", icon: "clipboard-outline" },
  { value: "staff", label: "Staff", short: "Staff", icon: "briefcase-outline" },
];

// Roles that manage the team (unlock the Team Hub tools in a later phase).
export const STAFF_ROLES: AthleteRole[] = ["coach", "team_rep", "staff"];

export const roleMeta = (role?: string | null): RoleMeta =>
  ROLES.find((r) => r.value === role) || ROLES[0];

export const roleLabel = (role?: string | null): string => roleMeta(role).label;
export const roleShort = (role?: string | null): string => roleMeta(role).short;
