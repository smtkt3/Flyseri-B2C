// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { VisaJourneyProgress, type VisaJourneyStep } from './VisaJourneyProgress';
afterEach(cleanup);
describe('shared visa journey progress', () => {
  const labels = ['Choose visa', 'Fill in the form', 'Upload documents', 'Review details', 'Payment'];
  const steps: VisaJourneyStep[] = ['choose', 'form', 'documents', 'review', 'payment'];
  it.each(steps)('preserves all five steps and highlights %s', current => {
    render(<VisaJourneyProgress current={current}/>);
    const items = within(screen.getByRole('navigation', { name: 'Visa application steps' })).getAllByRole('listitem');
    expect(items.map(item => item.querySelector('strong')?.textContent)).toEqual(labels);
    expect(items.filter(item => item.getAttribute('aria-current') === 'step')).toHaveLength(1);
    expect(items[steps.indexOf(current)]?.getAttribute('aria-current')).toBe('step');
    expect(items.filter(item => item.classList.contains('done'))).toHaveLength(steps.indexOf(current));
  });
  it('shows a completed journey without an active payment step', () => {
    render(<VisaJourneyProgress current="payment" complete/>);
    const items = screen.getAllByRole('listitem');
    expect(items.every(item => item.classList.contains('done'))).toBe(true);
    expect(items.some(item => item.hasAttribute('aria-current'))).toBe(false);
  });
});
