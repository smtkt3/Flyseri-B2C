import type { ReactNode } from 'react';
import './checkout-page-header.css';

export function CheckoutPageHeader({title,description,back,progress,introOnly=false}: {title?:ReactNode;description?:ReactNode;back?:ReactNode;progress?:ReactNode;introOnly?:boolean}) {
  return <header className="checkout-page-header">
    {back && <nav className="checkout-page-back" aria-label="Back navigation">{back}</nav>}
    {progress}
    {title && <h1 className={introOnly ? 'sr-only' : undefined}>{title}</h1>}
    {description && !introOnly && <p>{description}</p>}
  </header>;
}
