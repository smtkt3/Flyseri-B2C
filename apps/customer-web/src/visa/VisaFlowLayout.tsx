import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { CheckoutActionBar } from '../components/CheckoutActionBar';
import { CheckoutPageHeader } from '../flight/CheckoutPageHeader';
import './visa-flow-compact.css';

export function VisaFlowHeader({title,description,back}:{title:ReactNode;description:ReactNode;back?:ReactNode}) {
  return <CheckoutPageHeader title={title} description={description} back={back}/>;
}
export function VisaFlowActions({caption,back,next='Continue application',children}:{caption?:ReactNode;back?:ReactNode;next?:ReactNode;children:ReactNode}) {
  const navigationBack = isValidElement(back)
    ? cloneElement(back as ReactElement<{className?:string}>, {className:`${(back.props as {className?:string}).className || ''} account-outline-button`.trim()})
    : back;
  return <CheckoutActionBar label="Visa application navigation" caption={caption || 'Next step'} total={next}>{navigationBack}{children}</CheckoutActionBar>;
}
