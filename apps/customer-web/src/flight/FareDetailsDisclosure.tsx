import { useState, type ReactNode } from 'react';

export function FareDetailsDisclosure({defaultOpen,label,children}:{defaultOpen:boolean;label:string;children:ReactNode}) {
  const [open,setOpen] = useState(defaultOpen);
  return <details className="flight-fare-full-details" open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary><span>{label}</span><span>{open?'Hide details':'View details'} <span aria-hidden="true">›</span></span></summary>
    <div className="flight-fare-full-details-body">{children}</div>
  </details>;
}
