// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { PageRecovery, PageRecoveryBoundary } from './PageRecovery';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function BrokenPage(): never { throw new Error('Simulated page failure'); }
function RoutedBoundary() {
  const location = useLocation();
  return <PageRecoveryBoundary key={location.pathname}><Routes>
    <Route path="/broken" element={<BrokenPage />} />
    <Route path="/app/bookings" element={<h1>Saved bookings</h1>} />
    <Route path="*" element={<PageRecovery />} />
  </Routes></PageRecoveryBoundary>;
}
it('recovers from a page crash without blocking navigation to saved bookings', () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  render(<MemoryRouter initialEntries={['/broken']}><RoutedBoundary /></MemoryRouter>);
  expect(screen.getByRole('heading', {name:'This page couldn’t open'})).toBeTruthy();
  expect(screen.getByText(/Check your booking status before submitting again/)).toBeTruthy();
  fireEvent.click(screen.getByRole('link', {name:'My bookings'}));
  expect(screen.getByRole('heading', {name:'Saved bookings'})).toBeTruthy();
});
it('gives an unknown URL a useful recovery action', () => {
  render(<MemoryRouter initialEntries={['/unknown']}><RoutedBoundary /></MemoryRouter>);
  expect(screen.getByRole('heading', {name:'We couldn’t find this page'})).toBeTruthy();
  fireEvent.click(screen.getByRole('link', {name:'My bookings'}));
  expect(screen.getByRole('heading', {name:'Saved bookings'})).toBeTruthy();
});
