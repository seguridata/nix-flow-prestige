"use client";

export function Timeline({
  items,
}: {
  items: { id: string; title: string; meta?: string; body?: string }[];
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin eventos.</p>;
  }
  return (
    <ol className="relative space-y-4 border-l border-border pl-5">
      {items.map((item) => (
        <li key={item.id} className="relative">
          <span className="absolute top-1.5 -left-[23px] size-2.5 rounded-full bg-primary" />
          <p className="text-sm font-medium">{item.title}</p>
          {item.meta ? <p className="text-xs text-muted-foreground">{item.meta}</p> : null}
          {item.body ? <p className="mt-1 text-sm text-muted-foreground">{item.body}</p> : null}
        </li>
      ))}
    </ol>
  );
}
