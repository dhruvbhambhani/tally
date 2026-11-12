import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 cursor-pointer [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-accent text-white hover:bg-[#0d6660]",
        outline: "border border-line bg-white text-ink hover:bg-wash",
        ghost: "text-ink hover:bg-wash",
        link: "text-accent underline-offset-4 hover:underline px-0 h-auto",
      },
      size: {
        md: "h-10 px-4",
        sm: "h-8 px-3 text-[13px]",
        lg: "h-12 px-6 text-base",
      },
    },
    defaultVariants: { variant: "outline", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), variant === "link" && "h-auto px-0", className)} {...props} />;
}

export { buttonVariants };
