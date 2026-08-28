import Link from "next/link";
import { cn } from "@/libs/utils";

export function SeguriDataLogo({
  className,
  inverted = false,
  showWordmark = true,
}: {
  className?: string;
  inverted?: boolean;
  showWordmark?: boolean;
}) {
  return (
    <Link href="/inbox" className={cn("flex items-center gap-2.5", className)}>
      <img
        src="/brand/seguridata-logo.png"
        alt="SeguriData"
        className="size-8 rounded-md object-contain"
        width={32}
        height={32}
      />
      {showWordmark ? (
        <span className="flex flex-col leading-none">
          <span className={cn("text-[15px] font-semibold tracking-tight", inverted ? "text-white" : "text-foreground")}>
            Seguri<span className="text-primary">Data</span>
          </span>
          <span className={cn("mt-0.5 text-[10px] font-medium uppercase tracking-[0.16em]", inverted ? "text-white/55" : "text-muted-foreground")}>
            Prestige
          </span>
        </span>
      ) : null}
    </Link>
  );
}
