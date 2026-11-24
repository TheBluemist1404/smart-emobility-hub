// Lucide icons by their kebab-case name, as the mockups write them (data-lucide="map-pin").
import { icons, type LucideProps } from "lucide-react";

const pascal = (s: string) => s.replace(/(^|-)([a-z0-9])/g, (_m, _d, c: string) => c.toUpperCase());

/** Lucide has no e-motorbike; this one follows its 24 px grid and 2 px stroke (same as ds.js). */
function Motorbike(props: LucideProps) {
  const { size = 24, className } = props;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`lucide ${className ?? ""}`}>
      <circle cx="5" cy="17" r="3" /><circle cx="19" cy="17" r="3" /><path d="M8 17h6.5l2.2-7.5" /><path d="M14.5 5h2.5l2 12" />
      <path d="M4 12.5h6.5l1.5 4.5" /><path d="M2.5 12.5c.5-1.5 1.8-2.5 3.5-2.5h3" />
    </svg>
  );
}

export function Icon({ name, className, style }: { name: string; className?: string; style?: React.CSSProperties }) {
  if (name === "motorbike") return <Motorbike className={className} />;
  const C = (icons as Record<string, React.ComponentType<LucideProps>>)[pascal(name)];
  if (!C) return <span className={className} style={style}>?</span>;
  return <C className={`lucide ${className ?? ""}`} style={style} />;
}
