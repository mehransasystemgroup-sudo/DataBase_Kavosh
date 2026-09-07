import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-brand text-brand-foreground shadow-sm hover:bg-brand/90 hover:shadow-glow",
        soft: "bg-brand/12 text-brand-text border border-brand/25 hover:bg-brand/20",
        destructive: "bg-err text-destructive-foreground shadow-sm hover:bg-err/90",
        outline:
          "border border-border bg-surface text-foreground shadow-sm hover:border-brand/45 hover:bg-surfaceHover hover:text-brand-text",
        secondary: "bg-surfaceHover text-foreground hover:bg-surfaceHover/70",
        ghost: "text-muted-foreground hover:bg-surfaceHover hover:text-foreground",
        link: "text-brand-text underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-3.5 py-2",
        sm: "h-8 rounded-sm px-2.5 text-xs",
        xs: "h-7 rounded-sm px-2 text-[11px] [&_svg]:size-3.5",
        lg: "h-11 rounded-lg px-6 text-base",
        icon: "h-9 w-9",
        "icon-sm": "h-8 w-8 rounded-sm",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

const Button = React.forwardRef(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
