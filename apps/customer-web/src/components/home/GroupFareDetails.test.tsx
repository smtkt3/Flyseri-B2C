// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GroupFareDetails } from './GroupFareDetails';
import { activeGroupFare } from './groupFares';
beforeEach(() => { sessionStorage.clear(); HTMLDialogElement.prototype.showModal = vi.fn(function(this:HTMLDialogElement){this.setAttribute('open','');}); });
afterEach(() => cleanup());
it('guides missing dates, shows the selected total and included conditions before a demo hold', () => {
  render(<MemoryRouter><GroupFareDetails offer={{code:'KUL',city:'Kuala Lumpur',airline:'MH',name:'Malaysia Airlines',price:'22500'}} onClose={vi.fn()}/></MemoryRouter>);
  fireEvent.click(screen.getByRole('button',{name:'Continue to demo booking'}));
  const date = screen.getByLabelText(/Preferred departure/);
  expect(document.activeElement).toBe(date);
  expect(date.getAttribute('aria-invalid')).toBe('true');
  fireEvent.change(date,{target:{value:activeGroupFare('KUL')!.travelDates![0]}});
  fireEvent.change(screen.getByLabelText('Number of travellers'),{target:{value:'2'}});
  expect(screen.getByText(/45,000/)).toBeTruthy();
  expect(screen.getByText('20 kg checked + 7 kg cabin (demo)')).toBeTruthy();
  expect(screen.getByText('Included')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Continue to demo booking'}));
  expect(screen.getByLabelText('Time remaining').textContent).toBe('5:00');
  fireEvent.click(screen.getByRole('button',{name:'Save demo reservation'}));
  expect(document.activeElement).toBe(screen.getAllByRole('textbox')[0]);
  expect(screen.getAllByRole('textbox')[0]!.getAttribute('aria-describedby')).toBe('demo-name-0-error');
  expect(screen.queryByText('Demo reservation saved')).toBeNull();
});
