import type { ReactNode } from 'react';
import './checkout-page-header.css';

export function CheckoutPageHeader({title,description,back}: {title:ReactNode;description?:ReactNode;back?:ReactNode}) {
  return <header className="checkout-page-header">
    {back && <nav className="checkout-page-back" aria-label="Back navigation">{back}</nav>}
    <h1>{title}</h1>
    {description && <p>{description}</p>}
  </header>;
}
