import type { GateTheme, PresetName } from "./types.js";

const SYSTEM_FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

/** The original dark look of the reference implementation. */
export const dark: GateTheme = {
  colorScheme: "dark",
  background: "#090a0c",
  glow: "radial-gradient(circle at 50% 5%, rgba(102, 169, 255, .12), transparent 38rem)",
  panel: "#17181b",
  border: "#30333a",
  text: "#f4f6fb",
  muted: "#adb3bd",
  accent: "#70b5ff",
  accentText: "#08111d",
  error: "#ff9b9b",
  inputBackground: "#0e0f12",
  radius: "18px",
  font: SYSTEM_FONT,
  headingFont: 'Georgia, "Times New Roman", serif',
};

/** Warm light look: off-white paper, ink text, olive accent. */
export const paper: GateTheme = {
  colorScheme: "light",
  background: "#f4f3ec",
  glow: "",
  panel: "#ffffff",
  border: "#dedcd0",
  text: "#3a3c33",
  muted: "#6f7265",
  accent: "#3f4a2e",
  accentText: "#ffffff",
  error: "#a83a2c",
  inputBackground: "#fbfaf6",
  radius: "14px",
  font: SYSTEM_FONT,
  headingFont: SYSTEM_FONT,
};

export const presets: Record<PresetName, GateTheme> = { dark, paper };

export function isPresetName(value: unknown): value is PresetName {
  return value === "dark" || value === "paper";
}
