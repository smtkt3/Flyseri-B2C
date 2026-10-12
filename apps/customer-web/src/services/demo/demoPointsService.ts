import { FLYSERI_POINTS_RULES, type PointsWallet } from '@flyseri/types';
export type DemoPointsState={wallet:PointsWallet;stage:'READY'|'PENDING'|'AVAILABLE'|'REDEEMED'|'REFUNDED';earned:number;redeemed:number;fare:number};
export function initialDemoPoints():DemoPointsState {
  return {wallet:{rules:FLYSERI_POINTS_RULES,available:500,pending:0,reserved:0,adjustmentDue:0,expiring:null,activity:[],page:1,hasMore:false},stage:'READY',earned:0,redeemed:0,fare:25000};
}
export function demoPointsTransition(state:DemoPointsState,action:'PURCHASE'|'COMPLETE'|'REDEEM'|'REFUND',points=100):DemoPointsState {
  const next:DemoPointsState={...state,wallet:{...state.wallet,activity:[...state.wallet.activity]}};
  function log(kind:string,value:number,description:string){next.wallet.activity.unshift({id:crypto.randomUUID(),kind,points:value,description,createdAt:new Date().toISOString(),orderId:null});}
  if(action==='PURCHASE'&&['READY','REDEEMED'].includes(state.stage)) {
    next.earned=Math.floor((state.fare-state.redeemed)/1000);next.wallet.pending+=next.earned;next.wallet.reserved=0;next.stage='PENDING';
    if(state.redeemed)log('REDEEMED',0,`${state.redeemed} demo points used on the ticket`);
    log('PENDING',next.earned,'Demo ticket · points pending');
  } else if(action==='COMPLETE'&&state.stage==='PENDING') {
    next.wallet.pending-=state.earned;next.wallet.available+=state.earned;next.stage='AVAILABLE';log('EARNED',state.earned,'Demo journey verified · 7-day waiting period simulated');
  } else if(action==='REDEEM'&&state.stage==='READY') {
    if(!Number.isSafeInteger(points)||points<100||points>Math.min(state.wallet.available,Math.floor(state.fare*.1)))throw new Error('Use at least 100 whole points, within your balance and 10% of the fare.');
    next.redeemed=points;next.wallet.available-=points;next.wallet.reserved=points;next.stage='REDEEMED';log('RESERVED',-points,`Demo checkout · BDT ${points} discount reserved`);
  } else if(action==='REFUND'&&['PENDING','AVAILABLE'].includes(state.stage)) {
    if(state.stage==='PENDING')next.wallet.pending-=state.earned;else next.wallet.available-=state.earned;
    next.wallet.available+=state.redeemed;next.stage='REFUNDED';log('REFUND',state.redeemed-state.earned,'Demo refund · earning reversed and redemption restored');
  } else throw new Error('This action is unavailable at the current demo step.');
  return next;
}
