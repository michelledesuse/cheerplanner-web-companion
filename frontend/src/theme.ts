export const colors = {
  bg: "#FAFAF9",          // stone-50
  card: "#FFFFFF",
  cardSubtle: "#F5F5F4",   // stone-100
  border: "#E7E5E4",       // stone-200
  borderSoft: "#F5F5F4",
  primary: "#0F172A",      // slate-900
  primaryText: "#FFFFFF",
  accent: "#E11D48",       // rose-600
  accentSubtle: "#FFF1F2", // rose-50
  accentBorder: "#FECDD3", // rose-200
  textPrimary: "#0F172A",
  textSecondary: "#64748B", // slate-500
  textTertiary: "#94A3B8",  // slate-400
  success: "#059669",       // emerald-600
  successBg: "#D1FAE5",     // emerald-100
  successText: "#047857",   // emerald-700
  warning: "#D97706",       // amber-600
  warningBg: "#FEF3C7",
  warningText: "#B45309",
  danger: "#E11D48",
  dangerBg: "#FFE4E6",
  dangerText: "#BE123C",
  divider: "#F1F5F9",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
};

export const typography = {
  // Manrope for headings, IBM Plex Sans for body — falling back to system
  display: { fontSize: 32, fontWeight: "800" as const, letterSpacing: -0.5 },
  h1: { fontSize: 26, fontWeight: "800" as const, letterSpacing: -0.4 },
  h2: { fontSize: 20, fontWeight: "700" as const, letterSpacing: -0.2 },
  h3: { fontSize: 17, fontWeight: "700" as const },
  body: { fontSize: 15, fontWeight: "400" as const },
  bodyMedium: { fontSize: 15, fontWeight: "500" as const },
  caption: { fontSize: 13, fontWeight: "500" as const },
  micro: { fontSize: 11, fontWeight: "600" as const, letterSpacing: 0.5 },
};

export const shadow = {
  card: {
    shadowColor: "#0F172A",
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
};
