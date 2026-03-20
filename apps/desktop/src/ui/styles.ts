import type { CSSProperties } from "react";

export const pageStyle: CSSProperties = {
  background: "#09111f",
  color: "#e8eefc",
  minHeight: "100vh",
  fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
  padding: 24
};

export const shellGridStyle: CSSProperties = {
  display: "grid",
  gap: 20,
  gridTemplateColumns: "minmax(280px, 320px) minmax(0, 1fr)",
  alignItems: "start"
};

export const cardStyle: CSSProperties = {
  background: "linear-gradient(180deg, rgba(18, 28, 48, 0.96), rgba(12, 20, 35, 0.96))",
  border: "1px solid rgba(148, 163, 184, 0.18)",
  borderRadius: 16,
  padding: 16,
  boxShadow: "0 18px 50px rgba(2, 8, 23, 0.28)"
};

export const subtleCardStyle: CSSProperties = {
  ...cardStyle,
  background: "rgba(15, 23, 42, 0.72)",
  boxShadow: "none"
};

export const primaryButtonStyle: CSSProperties = {
  appearance: "none",
  border: "none",
  borderRadius: 12,
  background: "linear-gradient(135deg, #4f8cff, #7c5cff)",
  color: "#f8fbff",
  fontWeight: 700,
  padding: "11px 14px",
  cursor: "pointer"
};

export const secondaryButtonStyle: CSSProperties = {
  appearance: "none",
  borderRadius: 12,
  background: "rgba(15, 23, 42, 0.8)",
  color: "#dbe7ff",
  border: "1px solid rgba(148, 163, 184, 0.22)",
  fontWeight: 600,
  padding: "11px 14px",
  cursor: "pointer"
};

export const inputStyle: CSSProperties = {
  width: "100%",
  borderRadius: 12,
  border: "1px solid rgba(148, 163, 184, 0.22)",
  background: "rgba(9, 17, 31, 0.95)",
  color: "#eef4ff",
  padding: "12px 14px",
  fontSize: 14
};
