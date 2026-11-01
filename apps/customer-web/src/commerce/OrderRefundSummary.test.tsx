// @vitest-environment jsdom
import {render,screen,cleanup} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {OrderRefundSummary} from './OrderRefundSummary';
afterEach(cleanup);
it('shows a verified partial refund separately from the original payment',()=>{
 render(<OrderRefundSummary refunds={[{status:'SUCCEEDED',amount:'4549.00',currency:'BDT',completedAt:'2026-10-28T03:02:00Z'}]}/>);
 expect(screen.getByRole('region',{name:'Refund status'})).toBeTruthy();
 expect(screen.getByText('Refund completed')).toBeTruthy();
 expect(screen.getByText(/4,549/)).toBeTruthy();
 expect(screen.getByText(/Returned to your original payment method/)).toBeTruthy();
});
it('never labels an unconfirmed refund as completed',()=>{
 render(<OrderRefundSummary refunds={[{status:'PROCESSING',amount:'6049.00',currency:'BDT',completedAt:null}]}/>);
 expect(screen.getByText('Refund processing')).toBeTruthy();
 expect(screen.queryByText('Refund completed')).toBeNull();
});
it('hides cancelled refund requests',()=>{
 render(<OrderRefundSummary refunds={[{status:'CANCELLED',amount:'6049.00',currency:'BDT',completedAt:null}]}/>);
 expect(screen.queryByRole('region',{name:'Refund status'})).toBeNull();
});
