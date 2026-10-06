import { useEffect, useState } from 'react';
import { VisaJourneyProgress, type VisaJourneyStep } from './VisaJourneyProgress';
const steps: VisaJourneyStep[] = ['choose','form','documents','review','payment'];
export function SavedVisaJourneyProgress({requestId,current,complete=false,disabled=false}:{requestId:string;current:VisaJourneyStep;complete?:boolean;disabled?:boolean}) {
  const key='flyseri.visa-progress.'+requestId;
  const currentIndex=steps.indexOf(current);
  const [reached,setReached]=useState(2);
  useEffect(()=>{
    let previous=2;
    try { const saved=Number(sessionStorage.getItem(key)); if(Number.isInteger(saved)&&saved>=2&&saved<=4)previous=saved; } catch { /* Navigation still works without browser storage. */ }
    const next=Math.max(previous,currentIndex);
    setReached(next);
    try {sessionStorage.setItem(key,String(next));} catch { /* No applicant information is stored here. */ }
  },[key,currentIndex]);
  const furthest=Math.max(reached,currentIndex);
  const base='/app/visa/assistance/'+requestId;
  const destinations={choose:base+'/documents?step=choose',form:base+'/documents?step=form',documents:base+'/documents',review:base+'/documents?step=review',payment:base+'/payment'};
  const links=disabled?{}:Object.fromEntries(steps.filter((_,index)=>complete||index<=furthest).map(step=>[step,destinations[step]]));
  return <VisaJourneyProgress current={current} reached={steps[furthest]} complete={complete} links={links}/>;
}
