import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from './utils';

const badgeVariants = cva(
  'inline-flex items-center justify-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-mono font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'bg-primary/10 text-primary',
        secondary: 'bg-secondary text-secondary-foreground',
        accent: 'bg-accent/10 text-accent',
        destructive: 'bg-destructive/10 text-destructive',
        outline: 'border border-border text-muted-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.ComponentProps<'span'>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
