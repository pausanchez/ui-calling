import type { ReactNode } from "react";

/**
 * The frame every screen shares: one phone-width column, a card, and buttons with 44px targets. Change these to
 * restyle all your screens at once. `npx ui-calling new` imports them from here.
 *
 *   <Shell><Card>…</Card><button className={btn("primary", "w-full")}>…</button></Shell>
 *   <Shell steps>…<ActionBar … /></Shell>   // a screen with steps: full height, room for the sticky bottom bar
 */
export function Shell({ children, steps }: { children: ReactNode; steps?: boolean }) {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className={`mx-auto flex max-w-md flex-col px-4 ${steps ? "min-h-dvh gap-5 pt-6" : "gap-4 py-6"}`}>{children}</div>
    </main>
  );
}

export function Card({ children, className = "", role }: { children: ReactNode; className?: string; role?: string }) {
  return <section role={role} className={`rounded-lg border border-border bg-card p-4 text-card-foreground ${className}`}>{children}</section>;
}

/** Button classes: `primary` for the screen's one action, `outline` for the rest. Also for links styled as buttons. */
export function btn(variant: "primary" | "outline", extra = "") {
  const base =
    "inline-flex h-11 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const v = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/90",
    outline: "border border-border bg-card hover:bg-muted",
  }[variant];
  return `${base} ${v} ${extra}`;
}

/** A placeholder in the screen's shape while its data loads. */
export function Skeleton() {
  return <div aria-busy="true" className="h-40 animate-pulse rounded-lg bg-muted" />;
}
