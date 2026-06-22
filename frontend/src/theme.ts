// Design tokens — Revolut-inspired dark theme

export const colors = {
  // Surfaces (dark)
  surface: "#0A0A0B",
  onSurface: "#FFFFFF",
  surfaceSecondary: "#16161A",
  onSurfaceSecondary: "#FFFFFF",
  surfaceTertiary: "#1F1F25",
  onSurfaceTertiary: "#E4E4E7",
  surfaceInverse: "#FFFFFF",
  onSurfaceInverse: "#0A0A0B",
  // Brand: Revolut-style electric blue + purple
  brand: "#0666EB",
  brandPrimary: "#0666EB",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#11233F",
  onBrandSecondary: "#7AB1FF",
  brandTertiary: "#1A1A2E",
  onBrandTertiary: "#B19CFF",
  brandPurple: "#7B5FF6",
  // Semantic
  success: "#22C55E",
  warning: "#F59E0B",
  error: "#EF4444",
  info: "#0EA5E9",
  // Lines
  border: "#27272A",
  borderStrong: "#3F3F46",
  divider: "#1F1F25",
  muted: "#A1A1AA",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const radius = {
  sm: 8,
  md: 14,
  lg: 22,
  xl: 28,
  pill: 999,
};

export const font = {
  xs: 10,
  sm: 12,
  base: 14,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 40,
};

export const shadows = {
  card: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 4,
  },
  floating: {
    shadowColor: "#0666EB",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 10,
  },
};

export const gradients = {
  heroBlue: ["#0666EB", "#7B5FF6"] as const,
  heroPurple: ["#7B5FF6", "#EC4899"] as const,
  heroDark: ["#1F1F25", "#0A0A0B"] as const,
  glass: ["rgba(255,255,255,0.08)", "rgba(255,255,255,0)"] as const,
};
