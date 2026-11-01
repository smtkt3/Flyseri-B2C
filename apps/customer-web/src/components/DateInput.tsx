import { forwardRef, useImperativeHandle, useRef, useState, type InputHTMLAttributes } from 'react';
import { CalendarDateField } from './CalendarDateField';

/** Keep native date validity and form events while displaying the shared app calendar. */
export const DateInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: string }>(function DateInput({ label, className = '', onInvalid, ...props }, forwardedRef) {
  const input = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useImperativeHandle(forwardedRef, () => input.current!);
  const focusTrigger = () => field.current?.querySelector<HTMLButtonElement>('.calendar-date-trigger')?.focus();
  return <div ref={field} className={`app-date-input ${className}`}>
    <input {...props} ref={input} type="date" className="app-date-native" tabIndex={-1} aria-hidden="true" onFocus={focusTrigger} onInvalid={event => { event.preventDefault(); onInvalid?.(event); setOpen(true); focusTrigger(); }}/>
    <CalendarDateField label={label} className="checkout-calendar-field" controlId={props.id ? `${props.id}-picker` : undefined} value={String(props.value ?? '')} minDate={props.min === undefined ? undefined : String(props.min)} maxDate={props.max === undefined ? undefined : String(props.max)} disabled={props.disabled} required={props.required} invalid={props['aria-invalid']} describedBy={props['aria-describedby']} allowClear={!props.required} open={open} onOpenChange={next => { if (!input.current?.matches(':disabled')) setOpen(next); }} onChange={value => {
      const control = input.current;
      if (!control || control.matches(':disabled')) return;
      // Use the native setter so React receives one real change event, including form bubbling.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(control, value);
      control.dispatchEvent(new Event('input', { bubbles: true }));
      control.dispatchEvent(new Event('change', { bubbles: true }));
    }}/>
  </div>;
});
