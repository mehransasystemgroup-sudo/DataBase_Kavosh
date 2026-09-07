import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

/*
  رادیکس مقدار `dir` را روی ریشه‌ی تب‌ها می‌نویسد و پیش‌فرضش «ltr» است؛
  بدون تعیین صریح، همه‌ی محتوای داخل تب‌ها در این اپِ راست‌به‌چپ برعکس
  چیده می‌شود. پس پیش‌فرض را rtl می‌گذاریم و امکان بازنویسی را باز.
*/
const Tabs = React.forwardRef(({ dir = "rtl", ...props }, ref) => (
  <TabsPrimitive.Root ref={ref} dir={dir} {...props} />
));
Tabs.displayName = TabsPrimitive.Root.displayName;

const TabsList = React.forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex items-center gap-1 rounded-lg border border-border bg-ink p-1 text-muted-foreground",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex min-h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm px-3 py-1.5 text-xs font-medium transition-colors sm:min-h-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-brand/15 data-[state=active]:text-brand-text data-[state=active]:shadow-sm hover:text-foreground",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
