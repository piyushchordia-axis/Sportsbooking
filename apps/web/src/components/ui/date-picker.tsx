import * as React from 'react';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { cn } from './utils';
import { Button } from './button';
import { Calendar } from './calendar';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export interface DatePickerProps {
  value?: Date;
  onChange?: (value: Date | undefined) => void;
  /** Placeholder shown on the trigger when no date is selected. */
  placeholder?: string;
  align?: 'start' | 'center' | 'end';
  className?: string;
  disabled?: boolean;
  id?: string;
}

/**
 * Single-date picker: Popover + the shared shadcn `Calendar` in `mode="single"`.
 * The single-date counterpart to `DateRangePicker` — same trigger styling and
 * house tokens, so date and range inputs read as one family. Closes on select.
 */
const DatePicker = React.forwardRef<HTMLButtonElement, DatePickerProps>(
  ({ value, onChange, placeholder = 'Pick a date', align = 'start', className, disabled, id }, ref) => {
    const [open, setOpen] = React.useState(false);

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            ref={ref}
            type="button"
            variant="outline"
            disabled={disabled}
            data-slot="date-picker-trigger"
            className={cn(
              'h-10 w-full justify-start rounded-xl px-3.5 text-left font-normal',
              !value && 'text-muted-foreground',
              className,
            )}
          >
            <CalendarIcon className="size-4 opacity-60" />
            <span className="truncate">{value ? format(value, 'LLL d, yyyy') : placeholder}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" align={align}>
          <Calendar
            mode="single"
            defaultMonth={value}
            selected={value}
            onSelect={(d) => {
              onChange?.(d);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    );
  },
);
DatePicker.displayName = 'DatePicker';

export { DatePicker };
