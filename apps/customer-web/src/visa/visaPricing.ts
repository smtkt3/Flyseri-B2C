import type { VisaType } from '@flyseri/types';

export function visaPurposeMatches(service:Pick<VisaType,'name'>,purpose:string) {
  if(purpose==='Tourism'&&/family|business|student|study|education|work|medical|transit/i.test(service.name))return false;
  const patterns:Record<string,string>={Tourism:'touris|holiday|visit',Study:'student|study|education',Business:'business','Family visit':'family',Work:'work|employment',Transit:'transit',Medical:'medical',Other:'other'};
  return new RegExp(patterns[purpose] || '^$','i').test(service.name);
}
export function visaPurposeForService(service:Pick<VisaType,'name'>|undefined,fallback:string) {
  if(!service)return fallback;
  return ['Study','Business','Family visit','Work','Transit','Medical','Tourism','Other'].find(purpose=>visaPurposeMatches(service,purpose)) || fallback;
}

/** Shared display calculation; the server confirms the payable amount at checkout. */
export function visaServiceFees(service:VisaType | undefined) {
  if (!service?.currency || !/^[A-Z]{3}$/.test(service.currency)) return {items:[], total:null};
  const items = [
    {label:'Government / embassy fee',amount:service.governmentFeeAmount},
    {label:'Flyseri service fee',amount:service.serviceFeeAmount},
    ...(service.otherFeeComponents || []),
  ].filter((item): item is {label:string;amount:string} => typeof item.amount === 'string' && /^\d+(?:\.\d+)?$/.test(item.amount));
  // Preserve decimal precision. Partial fee data must not become an advertised total.
  const complete = service.governmentFeeAmount != null && service.serviceFeeAmount != null && items.length === 2 + (service.otherFeeComponents?.length || 0);
  if (!complete) return {items,total:null};
  const precision = Math.max(2,...items.map(item => item.amount.split('.')[1]?.length || 0));
  const sum = items.reduce((total,item) => { const [whole,fraction=''] = item.amount.split('.'); return total + BigInt(whole! + fraction.padEnd(precision,'0')); },0n).toString().padStart(precision+1,'0');
  return {items,total:sum.slice(0,-precision)+'.'+sum.slice(-precision)};
}
