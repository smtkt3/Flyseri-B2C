// @vitest-environment jsdom
import {afterEach,expect,it} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {CheckoutPageHeader} from './CheckoutPageHeader';
import {BookingLoading} from './BookingLoading';
afterEach(cleanup);
it('keeps introductory page headings accessible without a visible title or description block',()=>{
 const {container}=render(<CheckoutPageHeader introOnly title="Review your trip" description="Check your flights before continuing." progress={<nav aria-label="Booking progress"/>}/>);
 expect(screen.getByRole('heading',{name:'Review your trip'}).className).toBe('sr-only');
 expect(container.querySelector('.checkout-page-header>p')).toBeNull();
 expect(screen.getByRole('navigation',{name:'Booking progress'})).toBeTruthy();
});
it('shows the introduction below the loading icon',()=>{
 render(<BookingLoading label="Loading your flight selection…" heading="Review your trip" description="Check your flights before continuing."/>);
 const loader=screen.getByRole('status',{name:'Loading your flight selection…'});
 expect(loader.querySelector('.home-loading-journey')?.nextElementSibling?.textContent).toContain('Review your trip');
 expect(loader.textContent).toContain('Check your flights before continuing.');
});
it('keeps final result headings visible',()=>{
 render(<CheckoutPageHeader title="Booking confirmed"/>);
 expect(screen.getByRole('heading',{name:'Booking confirmed'}).className).not.toBe('sr-only');
});
