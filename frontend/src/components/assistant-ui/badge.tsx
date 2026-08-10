"use client";

import type { ComponentProps } from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center gap-1 rounded-md text-xs font-medium transition-colors [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        outline:
          "border-input text-muted-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground border bg-transparent",
        secondary:
          "bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/80",
        muted:
          "bg-muted text-muted-foreground [a&]:hover:bg-muted/80 [a&]:hover:text-foreground",
        ghost:
          "text-muted-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground bg-transparent",
        // Semantic variants are token-driven, not raw palette. The vendored
        // originals hardcoded blue/amber/emerald/red with their own dark
        // variants, which sidesteps the theme and drifts from --destructive.
        info: "border border-border bg-accent text-accent-foreground",
        warning: "border border-warning/30 bg-warning/10 text-warning",
        success: "border border-success/30 bg-success/10 text-success",
        destructive:
          "border border-destructive/30 bg-destructive/10 text-destructive",
      },
      size: {
        sm: "px-1.5 py-0.5",
        default: "px-2 py-1",
        lg: "px-2.5 py-1.5 text-sm",
      },
    },
    defaultVariants: {
      variant: "outline",
      size: "default",
    },
  },
);

export type BadgeProps = ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    asChild?: boolean;
  };

function Badge({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: BadgeProps) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      data-size={size}
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
