import * as React from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { DayPicker, getDefaultClassNames } from 'react-day-picker';
import { cn } from './utils';
import { buttonVariants } from './button';

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

/**
 * react-day-picker (v10) styled to the Warm Industrial CSS-var tokens. Mirrors
 * the house shadcn look: token-driven colors, rounded selection, ghost-button
 * nav. Supports single/range/multiple modes via the standard `mode` prop.
 */
function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  const defaults = getDefaultClassNames();
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-1', className)}
      classNames={{
        root: cn(defaults.root, 'w-fit'),
        months: cn(defaults.months, 'flex flex-col gap-4 sm:flex-row'),
        month: cn(defaults.month, 'flex flex-col gap-4'),
        month_caption: cn(
          defaults.month_caption,
          'flex h-9 items-center justify-center px-9',
        ),
        caption_label: cn(defaults.caption_label, 'text-sm font-medium'),
        nav: cn(defaults.nav, 'absolute flex w-full items-center justify-between'),
        button_previous: cn(
          buttonVariants({ variant: 'ghost', size: 'icon' }),
          'size-7 p-0',
        ),
        button_next: cn(
          buttonVariants({ variant: 'ghost', size: 'icon' }),
          'size-7 p-0',
        ),
        month_grid: cn(defaults.month_grid, 'w-full border-collapse'),
        weekdays: cn(defaults.weekdays, 'flex'),
        weekday: cn(
          defaults.weekday,
          'text-muted-foreground w-9 rounded-md text-[0.8rem] font-normal',
        ),
        week: cn(defaults.week, 'mt-2 flex w-full'),
        day: cn(
          defaults.day,
          'relative size-9 p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-muted [&:has([aria-selected].day-range-end)]:rounded-r-lg [&:has([aria-selected].day-range-start)]:rounded-l-lg first:[&:has([aria-selected])]:rounded-l-lg last:[&:has([aria-selected])]:rounded-r-lg',
        ),
        day_button: cn(
          buttonVariants({ variant: 'ghost' }),
          'size-9 rounded-lg p-0 font-normal aria-selected:opacity-100',
        ),
        range_start: cn(defaults.range_start, 'day-range-start rounded-l-lg'),
        range_end: cn(defaults.range_end, 'day-range-end rounded-r-lg'),
        range_middle: cn(
          defaults.range_middle,
          'rounded-none aria-selected:bg-muted aria-selected:text-foreground',
        ),
        selected: cn(
          defaults.selected,
          'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground',
        ),
        today: cn(defaults.today, 'bg-muted text-foreground rounded-lg'),
        outside: cn(
          defaults.outside,
          'text-muted-foreground/50 aria-selected:text-muted-foreground',
        ),
        disabled: cn(defaults.disabled, 'text-muted-foreground/40 opacity-50'),
        hidden: cn(defaults.hidden, 'invisible'),
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevClassName, ...chevProps }) => {
          const Icon = orientation === 'left' ? ChevronLeftIcon : ChevronRightIcon;
          return <Icon className={cn('size-4', chevClassName)} {...chevProps} />;
        },
      }}
      {...props}
    />
  );
}
Calendar.displayName = 'Calendar';

export { Calendar };
