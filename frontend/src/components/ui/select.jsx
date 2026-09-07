import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * انتخابگر بومی مرورگر.
 *
 * روی موبایل، چرخ‌دنده‌ی خود سیستم‌عامل باز می‌شود که هم سریع‌تر است و هم
 * دسترس‌پذیرتر از هر منوی سفارشی — به همین دلیل به‌جای منوی رادیکس.
 */
const Select = React.forwardRef(({ className, children, ...props }, ref) => (
  <div className="relative">
    <select
      ref={ref}
      className={cn(
        "h-9 w-full appearance-none rounded-md border border-border bg-ink ps-3 pe-8 text-sm text-foreground shadow-sm transition-colors hover:border-borderStrong focus-visible:border-brand/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
    <ChevronDown className="pointer-events-none absolute end-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
  </div>
));
Select.displayName = "Select";

export { Select };
