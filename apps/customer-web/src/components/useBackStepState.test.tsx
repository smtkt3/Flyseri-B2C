// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useBackStepState } from './useBackStepState';

afterEach(cleanup);
function HistoryControls() {
  const navigate = useNavigate();
  return <><button onClick={() => navigate(-1)}>Back</button><button onClick={() => navigate(1)}>Forward</button></>;
}
function Home() {
  const [view, setView] = useBackStepState('search', 'flights');
  const [chat, setChat] = useBackStepState('chat', false);
  const location = useLocation();
  return <><p>View: {view}</p><p>Chat: {String(chat)}</p><p>Preserved: {location.state?.returnTo}</p>
    <button onClick={() => setView('map')}>Map</button><button onClick={() => setView('ai')}>AI</button>
    <button onClick={() => setChat(true)}>Open chat</button><button onClick={() => setChat(false)}>Close chat</button></>;
}
function setup() {
  render(<MemoryRouter initialEntries={['/previous', { pathname: '/', hash: '#book', state: { returnTo: 'booking' } }]}>
    <HistoryControls /><Routes><Route path="/" element={<Home />} /><Route path="/previous" element={<p>Previous page</p>} /></Routes>
  </MemoryRouter>);
}
it('unwinds chat and each search view individually, then allows normal page navigation', () => {
  setup();
  for (const name of ['Map', 'AI', 'Open chat']) fireEvent.click(screen.getByText(name));
  fireEvent.click(screen.getByText('Back'));
  expect(screen.getByText('Chat: false')).toBeTruthy();
  expect(screen.getByText('View: ai')).toBeTruthy();
  fireEvent.click(screen.getByText('Back'));
  expect(screen.getByText('View: map')).toBeTruthy();
  fireEvent.click(screen.getByText('Back'));
  expect(screen.getByText('View: flights')).toBeTruthy();
  expect(screen.getByText('Preserved: booking')).toBeTruthy();
  fireEvent.click(screen.getByText('Back'));
  expect(screen.getByText('Previous page')).toBeTruthy();
  fireEvent.click(screen.getByText('Forward'));
  expect(screen.getByText('View: flights')).toBeTruthy();
});
it('manual closing consumes the opening entry without leaving an extra back step', () => {
  setup();
  fireEvent.click(screen.getByText('Open chat'));
  fireEvent.click(screen.getByText('Close chat'));
  expect(screen.getByText('Chat: false')).toBeTruthy();
  fireEvent.click(screen.getByText('Back'));
  expect(screen.getByText('Previous page')).toBeTruthy();
});
