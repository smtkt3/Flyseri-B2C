// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { emptyHomeSearch, homeSearchUrl, normalizeHomeSearch, readSavedHomeSearch, updateHomeSearch, useHomeSearchField } from './homeSearchDraft';
import { SeriRichText } from './SeriRichText';
import { AirlineOfferDetails } from './AirlineOfferDetails';

beforeEach(() => { localStorage.clear(); updateHomeSearch(emptyHomeSearch); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('homepage search connections', () => {
  it('keeps mounted search fields synchronized and persists the latest draft', () => {
    function Field({ label }: { label: string }) { const [value, set] = useHomeSearchField('destination'); return <input aria-label={label} value={value} onChange={event => set(event.target.value)}/>; }
    render(<><Field label="Flights destination"/><Field label="Map destination"/></>);
    fireEvent.change(screen.getByLabelText('Map destination'), { target: { value: 'SIN' } });
    expect((screen.getByLabelText('Flights destination') as HTMLInputElement).value).toBe('SIN');
    expect(readSavedHomeSearch().destination).toBe('SIN');
  });
  it('drops stale dates and invalid passenger values from restored data', () => {
    const draft = normalizeHomeSearch({ origin: 'bad', departure: '2000-01-01', returnDate: 'invalid', adults: 8, children: 7, infants: 5, cabin: 'invalid' });
    expect(draft.origin).toBe('DAC'); expect(draft.departure).toBe(''); expect(draft.returnDate).toBe('');
    expect(draft.adults + draft.children + draft.infants).toBe(9); expect(draft.cabin).toBe('ECONOMY');
    localStorage.setItem('flyseri.home-search.v1', JSON.stringify({ savedAt: Date.now() - 8 * 86400000, draft: { destination: 'SIN' } }));
    expect(readSavedHomeSearch().destination).toBe('');
  });
  it('keeps dates, cabin and passengers in destination search links', () => {
    const params = new URLSearchParams(homeSearchUrl({ ...emptyHomeSearch, departure: '2030-01-12', returnDate: '2030-01-19', adults: 2, children: 1, cabin: 'BUSINESS' }, 'SIN').split('?')[1]);
    expect(params.get('returnDate')).toBe('2030-01-19'); expect(params.get('adults')).toBe('2'); expect(params.get('children')).toBe('1'); expect(params.get('cabin')).toBe('BUSINESS'); expect(params.get('autoSearch')).toBe('1');
  });
  it('renders AI lists and bold text safely and adds destination actions', () => {
    const { container } = render(<MemoryRouter><SeriRichText content={'## Ideas\n1. **Singapore** is a great option.\n2. Bangkok is another.\n<script>alert(1)</script>\n[Unsafe](javascript:alert(1))'}/></MemoryRouter>);
    expect(container.querySelectorAll('ol li').length).toBe(2); expect(container.querySelector('strong')?.textContent).toBe('Singapore'); expect(container.querySelector('script')).toBeNull();
    expect(screen.getByRole('link', { name: 'Flights to Singapore ↗' }).getAttribute('href')).toContain('destination=SIN'); expect(screen.queryByRole('link', { name: 'Unsafe' })).toBeNull();
  });
  it('opens an honest sample detail view and carries passenger changes into live search', () => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
    const onClose = vi.fn();
    render(<MemoryRouter><AirlineOfferDetails offer={{ city: 'Bangkok', code: 'BKK', airline: 'TG', name: 'Thai Airways', price: '18,900' }} onClose={onClose}/></MemoryRouter>);
    expect(screen.getByRole('dialog')).toBeTruthy(); expect(screen.getByText(/Sample offer · not bookable/)).toBeTruthy(); expect(screen.getByText('Check live availability')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Offer adults'), { target: { value: '2' } });
    expect(screen.getByRole('link', { name: 'Search live flights ↗' }).getAttribute('href')).toContain('adults=2');
    fireEvent.click(screen.getByRole('button', { name: 'Close offer details' })); expect(onClose).toHaveBeenCalledOnce();
  });
});
