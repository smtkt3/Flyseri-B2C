import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function CheckoutActionBar({ caption, total, label, detailsHref, children }: {
  caption: string; total: ReactNode; label: string; detailsHref?: string; children: ReactNode;
}) {
  return createPortal(<div className="checkout-mobile-bar" aria-label={label}>
    <div className="checkout-bar-price"><small>{caption}</small><strong>{total == null || total === '' ? 'Price unavailable' : total}</strong>{detailsHref && <a className="checkout-bar-details" href={detailsHref}>Price details <span aria-hidden="true">⌄</span></a>}</div>
    <div className="checkout-bar-actions">{children}</div>
  </div>, document.body);
}
