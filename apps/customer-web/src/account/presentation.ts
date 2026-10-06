import type { FlightBookingIntentStatus, OrderStatus, PaymentSummary, VisaApplicationStatus } from '@flyseri/types';

const orderLabels: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Payment required', PAYMENT_PROCESSING: 'Payment confirming', PAID: 'Payment confirmed',
  PAYMENT_FAILED: 'Payment failed', EXPIRED: 'Order expired', CANCELLED: 'Order cancelled',
};
const paymentLabels: Record<PaymentSummary['status'], string> = {
  CREATED: 'Payment started', PENDING: 'Payment pending', PROCESSING: 'Payment confirming', UNKNOWN: 'Payment under review',
  SUCCEEDED: 'Payment confirmed', FAILED: 'Payment failed', CANCELLED: 'Payment cancelled', EXPIRED: 'Payment expired',
};
const intentLabels: Record<FlightBookingIntentStatus, string> = {
  CREATED: 'Fare selected', VALIDATING: 'Checking fare', VALIDATED: 'Fare checked', PRICE_CHANGED: 'Fare changed',
  EXPIRED: 'Selection expired', READY_FOR_PAYMENT: 'Fare ready for order', FAILED: 'Fare check failed', CANCELLED: 'Selection removed',
};
const visaLabels: Record<VisaApplicationStatus, string> = {
  DRAFT: 'Draft application', INCOMPLETE: 'Checklist incomplete', READY_TO_SUBMIT: 'Ready to submit',
  SUBMITTED: 'Application submitted', AWAITING_PAYMENT: 'Payment required', PAYMENT_CONFIRMING: 'Payment confirming',
  PAYMENT_FAILED: 'Payment failed', PAID: 'Payment received', DOCUMENT_REVIEW: 'Documents under review',
  ADDITIONAL_DOCUMENTS_REQUIRED: 'Documents need attention', APPLICATION_PREPARATION: 'Application preparation',
  READY_FOR_SUBMISSION_TO_AUTHORITY: 'Preparing authority submission', SUBMITTED_TO_EMBASSY_OR_AUTHORITY: 'Submitted for processing',
  UNDER_PROCESSING: 'Under processing', ADDITIONAL_INFORMATION_REQUIRED: 'More information required',
  APPROVED: 'Approved', VISA_ISSUED: 'Visa issued', REJECTED: 'Decision received', COMPLETED: 'Completed',
  DOCUMENTS_SUBMITTED: 'Documents submitted', CANCELLED: 'Application cancelled',
};

export const orderStatus = (status: OrderStatus) => orderLabels[status];
export const paymentStatus = (status: PaymentSummary['status']) => paymentLabels[status];
export const intentStatus = (status: FlightBookingIntentStatus) => intentLabels[status];
export const visaStatus = (status: VisaApplicationStatus) => visaLabels[status];

/** Money arrives as a decimal string. Group its digits for display without floating-point arithmetic. */
export function formatMoney(amount: string | null | undefined, currency: string | null | undefined): string {
  const code = currency?.trim().toUpperCase();
  const value = amount?.trim();
  if (!code || !/^[A-Z]{3}$/.test(code) || !value || !/^-?\d+(?:\.\d+)?$/.test(value)) return 'Amount unavailable';
  const negative = value.startsWith('-');
  const [whole, fraction] = (negative ? value.slice(1) : value).split('.');
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${code} ${negative ? '-' : ''}${grouped}${fraction === undefined ? '' : `.${fraction}`}`;
}

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}
