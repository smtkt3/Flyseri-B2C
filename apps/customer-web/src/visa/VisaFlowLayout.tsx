import type { ReactNode } from 'react';
import { CheckoutPageHeader } from '../flight/CheckoutPageHeader';
import './visa-flow-compact.css';

export function VisaFlowHeader({title,description,back}:{title:ReactNode;description:ReactNode;back?:ReactNode}) {
  return <CheckoutPageHeader title={title} description={description} back={back}/>;
}
export function VisaFlowActions({caption,back,children}:{caption?:ReactNode;back?:ReactNode;children:ReactNode}) {
  return <footer className="visa-flow-actions"><div className="visa-flow-actions-context">{back}{caption&&<span>{caption}</span>}</div><div className="visa-flow-actions-primary">{children}</div></footer>;
}
