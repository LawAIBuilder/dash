import type { CSSProperties, ReactNode } from "react";
import { cardStyle, subtleCardStyle } from "./styles.js";

export function StatusBadge({ label, tone }: { label: string; tone: "neutral" | "good" | "warn" | "bad" }) {
  const styles: Record<typeof tone, CSSProperties> = {
    neutral: {
      background: "rgba(148, 163, 184, 0.14)",
      color: "#dbe7ff",
      border: "1px solid rgba(148, 163, 184, 0.18)"
    },
    good: {
      background: "rgba(52, 211, 153, 0.14)",
      color: "#bef9dd",
      border: "1px solid rgba(52, 211, 153, 0.2)"
    },
    warn: {
      background: "rgba(250, 204, 21, 0.14)",
      color: "#fff0a8",
      border: "1px solid rgba(250, 204, 21, 0.2)"
    },
    bad: {
      background: "rgba(248, 113, 113, 0.14)",
      color: "#ffd0d0",
      border: "1px solid rgba(248, 113, 113, 0.22)"
    }
  };

  return (
    <span
      style={{
        ...styles[tone],
        borderRadius: 999,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 0.2,
        padding: "5px 10px",
        textTransform: "uppercase"
      }}
    >
      {label}
    </span>
  );
}

export function SectionCard({
  title,
  subtitle,
  action,
  children
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          {subtitle ? <p style={{ margin: "6px 0 0", opacity: 0.75, lineHeight: 1.5 }}>{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div
      style={{
        ...subtleCardStyle,
        borderStyle: "dashed",
        color: "#9fb0cc",
        fontSize: 14,
        textAlign: "center"
      }}
    >
      {message}
    </div>
  );
}

export function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gap: 8,
        gridTemplateColumns: "minmax(120px, 160px) minmax(0, 1fr)",
        padding: "10px 0",
        borderBottom: "1px solid rgba(148, 163, 184, 0.1)"
      }}
    >
      <div style={{ color: "#8ea2c7", fontSize: 13 }}>{label}</div>
      <div style={{ color: "#f5f8ff" }}>{value}</div>
    </div>
  );
}
