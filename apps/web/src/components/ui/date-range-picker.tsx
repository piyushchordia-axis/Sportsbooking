import * as React from 'react';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import type { DateRange } from 'react-day-picker';
import { cn } from './utils';
import { Button } from './button';
import { Calendar } from './calendar';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

/** Selected range value. Both bounds optional so the picker can be partly set. */
export interface DateRangeValue {
  from?: Date;
  to?: Date;
}

export interface DateRangePickerProps {
  value?: DateRangeValue;
  onChange?: (value: DateRangeValue) => void;
  /** Placeholder shown on the trigger when no range is selected. */
  placeholder?: string;
  /** Months rendered side-by-side in the popover. Defaults to 2. */
  numberOfMonths?: number;
  align?: 'start' | 'center' | 'end';
  className?: string;
  disabled?: boolean;
  id?: string;
}

function formatRange(value: DateRangeValue | undefined, placeholder: string): string {
  if (!value?.from) return placeholder;
  if (!value.to) return format(value.from, 'LLL d, yyyy');
  return `${format(value.from, 'LLL d, yyyy')} – ${format(value.to, 'LLL d, yyyy')}`;
}

/**
 * Popover + range Calendar that replaces dual from/to date inputs across the
 * admin UI. Takes a `{ from?, to? }` value + onChange, and renders a button
 * showing the selected range (or placeholder). Styled to the house tokens.
 */
const DateRangePicker = React.forwardRef<HTMLButtonElement, DateRangePickerProps>(
  (
    {
      value,
      onChange,
      placeholder = 'Pick a date range',
      numberOfMonths = 2,
      align = 'start',
      className,
      disabled,
      id,
    },
    ref,
  ) => {
    const [open, setOpen] = React.useState(false);

    const selected: DateRange | undefined = value?.from
      ? { from: value.from, to: value.to }
      : undefined;

    const handleSelect = (range: DateRange | undefined) => {
      onChange?.({ from: range?.from, to: range?.to });
    };

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            ref={ref}
            type="button"
            variant="outline"
            disabled={disabled}
            data-slot="date-range-picker-trigger"
            className={cn(
              'h-10 w-full justify-start rounded-xl px-3.5 text-left font-normal',
              !value?.from && 'text-muted-foreground',
              className,
            )}
          >
            <CalendarIcon className="size-4 opacity-60" />
            <span className="truncate">{formatRange(value, placeholder)}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" align={align}>
          <Calendar
            mode="range"
            defaultMonth={value?.from}
            selected={selected}
            onSelect={handleSelect}
            numberOfMonths={numberOfMonths}
          />
        </PopoverContent>
      </Popover>
    );
  },
);
DateRangePicker.displayName = 'DateRangePicker';

export { DateRangePicker };
