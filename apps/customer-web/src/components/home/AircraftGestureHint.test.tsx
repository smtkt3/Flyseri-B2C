// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import {AircraftGestureHint} from './AircraftGestureHint';
beforeEach(()=>{vi.useFakeTimers();sessionStorage.clear();});
afterEach(()=>{cleanup();vi.useRealTimers();});
function Hint({phase='idle',eligible=true,boosted=false}:{phase?:string;eligible?:boolean;boosted?:boolean}) {
  return <button>Chat<AircraftGestureHint phase={phase} eligible={eligible} boosted={boosted}/></button>;
}
it('shows one brief introduction per tab after a quiet delay',()=>{
  const view=render(<MemoryRouter><Hint/></MemoryRouter>);
  act(()=>vi.advanceTimersByTime(5999));expect(screen.queryByRole('status')).toBeNull();
  act(()=>vi.advanceTimersByTime(1));expect(screen.getByText('Pull down for takeoff ↓')).toBeTruthy();
  expect(screen.getByText('Or tap to chat')).toBeTruthy();
  act(()=>vi.advanceTimersByTime(7000));expect(screen.queryByRole('status')).toBeNull();
  view.unmount();render(<MemoryRouter><Hint/></MemoryRouter>);
  act(()=>vi.advanceTimersByTime(20000));expect(screen.queryByRole('status')).toBeNull();
});
it('dismisses on interaction and gives contextual pull and boost instructions',()=>{
  const view=render(<MemoryRouter><Hint/></MemoryRouter>);
  act(()=>vi.advanceTimersByTime(6000));fireEvent.pointerDown(screen.getByRole('button'));
  expect(screen.queryByRole('status')).toBeNull();
  view.rerender(<MemoryRouter><Hint phase="pulling"/></MemoryRouter>);
  expect(screen.getByText('Release to fly')).toBeTruthy();expect(screen.getByText('Hold for a boost')).toBeTruthy();
  view.rerender(<MemoryRouter><Hint phase="pulling" boosted/></MemoryRouter>);
  expect(screen.getByText('Ready for takeoff!')).toBeTruthy();
  view.rerender(<MemoryRouter><Hint phase="flying"/></MemoryRouter>);
  expect(screen.queryByRole('status')).toBeNull();
});
it.each(['/flight-checkout','/app/payments','/flight-review'])('stays quiet during %s',route=>{
  render(<MemoryRouter initialEntries={[route]}><Hint/></MemoryRouter>);
  act(()=>vi.advanceTimersByTime(15000));expect(screen.queryByRole('status')).toBeNull();
});
it('waits while typing or when the launcher is obstructed',()=>{
  const view=render(<MemoryRouter><input aria-label="Search"/><Hint eligible={false}/></MemoryRouter>);
  act(()=>vi.advanceTimersByTime(15000));expect(screen.queryByRole('status')).toBeNull();
  screen.getByRole('textbox').focus();
  view.rerender(<MemoryRouter><input aria-label="Search"/><Hint/></MemoryRouter>);
  act(()=>vi.advanceTimersByTime(15000));expect(screen.queryByRole('status')).toBeNull();
  screen.getByRole('textbox').blur();
  act(()=>vi.advanceTimersByTime(6000));expect(screen.getByRole('status')).toBeTruthy();
});
