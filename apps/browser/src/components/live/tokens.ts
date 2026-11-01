import { useTheme } from "../ui/theme";
import { duration, period, springs } from "../ui/motion";
import { colorRoles, font, ink, proseLineHeight, weight } from "../ui/tokens";

const DARK = {
  success: colorRoles.dark.success,
  failure: colorRoles.dark.destructive,
  pending: "#D29922",
  merged: "#A371F7",
  draft: "#8B949E",
  conflict: "#DB6D28",
  now: colorRoles.dark.destructive,
  ciTrack: "rgba(255,255,255,0.1)",
  chip: "rgba(255,255,255,0.1)",
  badgeRing: "rgba(0,0,0,0.35)",
  avatarFill: "#4A4A4F",
};

const LIGHT: typeof DARK = {
  success: colorRoles.light.success,
  failure: colorRoles.light.destructive,
  pending: "#9A6700",
  merged: "#8250DF",
  draft: "#6E7781",
  conflict: "#BC4C00",
  now: colorRoles.light.destructive,
  ciTrack: "rgba(0,0,0,0.08)",
  chip: "rgba(0,0,0,0.06)",
  badgeRing: "rgba(255,255,255,0.8)",
  avatarFill: "#D5D5DA",
};

export type LiveColors = typeof DARK;

export function useLiveColors(): LiveColors {
  return useTheme().dark ? DARK : LIGHT;
}

export const LIVE_NOW_TEXT = ink.white;

export const liveMotion = {
  badgeSpring: springs.bouncy,
  badgeHideSpring: springs.snappy,
  alertSpring: springs.bouncy,
  ciPulse: period.pulse,
  wiggle: [
    { to: 1, duration: duration.fast },
    { to: -1, duration: duration.fast },
    { to: 0.8, duration: duration.fast },
    { to: -0.6, duration: duration.fast },
    { to: 0.3, duration: duration.fast },
    { to: 0, duration: duration.fast },
  ],
};

export const liveType = {
  heading: { ...font.body, lineHeight: proseLineHeight.body, fontWeight: weight.semibold },
  detail: { ...font.small, lineHeight: proseLineHeight.small },
  empty: font.small,
  more: font.tiny,
  avatarScale: 0.42,
};
