import { FlightBaggageDetails, FlightServiceDetails, hasIncludedCheckedBaggage, hasKnownBaggage, hasKnownServices } from './FlightFareInformation';
import { lazy, Suspense, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { FlightCabin, FlightOffer, FlightSearchLeg, FlightSearchRequest, FlightSearchResponse, FlightTripType, TravellerProfile, TripDetail } from '@flyseri/types';
import { ApiClientError } from '../lib/api/client';
import { randomUUID } from '../lib/randomUUID';
import { flightService } from '../services/flightService';
import { tripService } from '../services/tripService';
import { travellerService } from '../services/travellerService';
import { CalendarDateField } from '../components/CalendarDateField';
import { AirportPicker, loadAirportDetails } from './AirportPicker';
import { AirlineIdentity, airlineName } from './AirlineIdentity';
import { emptyServicePreferences, FlightServiceRequestFields, hasServiceRequest } from './FlightServiceRequests';
import type { FlightServicePreferences, FlightAncillaryRequest } from '@flyseri/types';
import { FlightAirlineServices } from './FlightAirlineServices';
import { refreshAncillarySelections } from './flightAncillarySelections';
import { preferredCurrency, currencyPreferenceEvent } from '../components/LocaleMenu';
import { FlightDateStrip } from './FlightDateStrip';
import { FlightRowSkeleton, FlightSearchSkeleton, TravellerSelectionSkeleton } from './FlightSearchSkeleton';
import { mergeProgressiveFlightResults } from './progressiveFlightResults';
import { cabinOptions, cabinLabel, dateTime, legsOf, minutes, money, penaltySummary, travelDate } from './flightPresentation';
import { useAuth } from '../auth/AuthProvider';
import { flightBrowseSearchQuery, recallFlightBrowse, recallFlightBrowseBySearchId, recallLatestFlightBrowse, rememberFlightBrowse, type FlightBrowseSnapshot, type FlightSort } from './flightSearchBrowsing';
import { useCurrentCallback, useFlightDialog, useStableFlightGroups } from './flightUiHooks';

const FlightComparison = lazy(() => import('./FlightComparison'));
const emptyOffers:FlightOffer[]=[];
const emptyComparisonIds:string[]=[];
type Sort = FlightSort;
const flightLegKey = (leg: FlightOffer['outbound']) => `${leg.stops}:${leg.segments.map((segment) =>
  [segment.origin, segment.destination, segment.departureAt, segment.arrivalAt, segment.marketingCarrier, segment.flightNumber, segment.operatingCarrier ?? ''].join('|')).join(';')}`;
const legOf = (offer: FlightOffer, index: number) => legsOf(offer)[index];
const legFareKey = (offer: FlightOffer, index: number) => JSON.stringify([offer.cabin ?? null, offer.fareBrand ?? null, legOf(offer, index)?.segments.map(segment => segment.bookingClass ?? null)]);
const uniqueFlightCount = (offers: FlightOffer[], index: number) => new Set(offers.map((offer) => legOf(offer, index)).filter((leg): leg is FlightOffer['outbound'] => !!leg).map(flightLegKey)).size;
const durationForFilter = (offer: FlightOffer, index: number) => legOf(offer, index)?.durationMinutes ?? null;
const timeOfDay = (value: string) => { const match = /T(\d{2}):(\d{2})/.exec(value); return match ? Number(match[1]) * 60 + Number(match[2]) : null; };
const clockLabel = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
const code = (value: string) => value.trim().toUpperCase().match(/\(([A-Z]{3})\)$/)?.[1] ?? value.trim().toUpperCase();
const queryLegs = (value: string | null): FlightSearchLeg[] => { try { const parsed = value ? JSON.parse(value) : null; return Array.isArray(parsed) ? parsed.filter((leg) => leg && /^[A-Z]{3}$/.test(leg.origin) && /^[A-Z]{3}$/.test(leg.destination) && /^\d{4}-\d{2}-\d{2}$/.test(leg.departureDate)).slice(0, 6) : []; } catch { return []; } };

export function FlightSearchPage({ publicSearch = false }: { publicSearch?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useAuth();
  const owner = session?.user.id ?? null;
  const [restored] = useState(() => {
    const state = location.state as { flightBrowseKey?: unknown; flightBrowseSearchId?: unknown } | null;
    const key = typeof state?.flightBrowseKey === 'string' ? state.flightBrowseKey : location.key;
    return recallFlightBrowse(key, owner, publicSearch) ?? recallFlightBrowseBySearchId(state?.flightBrowseSearchId, owner, publicSearch) ??
      (new URLSearchParams(location.search).size === 0 ? recallLatestFlightBrowse(location.pathname, owner, publicSearch) : undefined);
  });
  const [params] = useSearchParams();
  const fromHomeSearch = params.get('autoSearch') === '1';
  const tripId = params.get('tripId') ?? undefined;
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [tripLoading, setTripLoading] = useState(!!tripId);
  const [tripError, setTripError] = useState('');
  const [origin, setOrigin] = useState(restored?.form.origin ?? params.get('origin') ?? '');
  const [destination, setDestination] = useState(restored?.form.destination ?? params.get('destination') ?? '');
  const [departureDate, setDepartureDate] = useState(restored?.form.departureDate ?? params.get('departureDate') ?? '');
  const [returnDate, setReturnDate] = useState(restored?.form.returnDate ?? params.get('returnDate') ?? '');
  const [tripType, setTripType] = useState<FlightTripType>(restored?.form.tripType ?? ((['ONE_WAY','MULTI_CITY'].includes(params.get('tripType') ?? '') ? params.get('tripType') : 'ROUND_TRIP') as FlightTripType));
  const [multiLegs, setMultiLegs] = useState<FlightSearchLeg[]>(() => restored?.form.multiLegs ?? (queryLegs(params.get('legs')).length ? queryLegs(params.get('legs')) : [
    { origin: params.get('origin') ?? '', destination: params.get('destination') ?? '', departureDate: params.get('departureDate') ?? '' },
    { origin: params.get('destination') ?? '', destination: '', departureDate: '' },
  ]));
  const [adults, setAdults] = useState(restored?.form.adults ?? (Number(params.get('adults')) || 1));
  const [children, setChildren] = useState(restored?.form.children ?? (Number(params.get('children')) || 0));
  const [infants, setInfants] = useState(restored?.form.infants ?? (Number(params.get('infants')) || 0));
  const [cabin, setCabin] = useState<FlightCabin>(restored?.form.cabin ?? (cabinOptions.find((option) => option.value === params.get('cabin'))?.value) ?? 'ECONOMY');
  const [passengerPickerOpen, setPassengerPickerOpen] = useState(false);
  const [currency, setCurrency] = useState(preferredCurrency);
  useEffect(() => {
    const update = (event: Event) => { const value = (event as CustomEvent<string>).detail; setCurrency(typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : preferredCurrency()); };
    window.addEventListener(currencyPreferenceEvent, update); window.addEventListener('storage', update);
    return () => { window.removeEventListener(currencyPreferenceEvent, update); window.removeEventListener('storage', update); };
  }, []);
  const restoreResult = restored?.form.currency === preferredCurrency() ? restored.result : null;
  const returningSearch = !!restored && (restored.refreshOnReturn || (!!restored.result && !restoreResult));
  const restoringSearch = useRef(returningSearch);
  const [result, setResult] = useState<FlightSearchResponse | null>(restoreResult);
  const [restoredResults, setRestoredResults] = useState(!!restoreResult);
  const rawOffers=result?.offers??emptyOffers;
  const airportCodes=useMemo(()=>[...new Set(rawOffers.flatMap(offer=>legsOf(offer).flatMap(leg=>leg.segments.flatMap(segment=>[segment.origin,segment.destination]))))].sort().join(','),[rawOffers]);
  const [stopAirports, setStopAirports] = useState<Record<string, { city: string; name: string }>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<Sort>(restored?.sort ?? 'RECOMMENDED');
  const [stopFilter, setStopFilter] = useState<'ANY' | 'NONSTOP' | 'ONE_OR_FEWER' | 'TWO_OR_MORE'>(restored?.stopFilter ?? 'ANY');
  const [baggageOnly, setBaggageOnly] = useState(restored?.baggageOnly ?? false);
  const [selectedAirlines, setSelectedAirlines] = useState<string[]>(restored?.selectedAirlines ?? []);
  const [airlineQuery, setAirlineQuery] = useState(restored?.airlineQuery ?? '');
  const [airlinesExpanded, setAirlinesExpanded] = useState(restored?.airlinesExpanded ?? false);
  const [refundableOnly, setRefundableOnly] = useState(restored?.refundableOnly ?? false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [departureWindow, setDepartureWindow] = useState<[number, number]>(restored?.departureWindow ?? [0, 1440]);
  const [arrivalWindow, setArrivalWindow] = useState<[number, number]>(restored?.arrivalWindow ?? [0, 1440]);
  const [maxDuration, setMaxDuration] = useState<number | null>(restored?.maxDuration ?? null);
  const [selectedStopovers, setSelectedStopovers] = useState<string[]>(restored?.selectedStopovers ?? []);
  const [selectedAirports, setSelectedAirports] = useState<string[]>(restored?.selectedAirports ?? []);
  const [selectedCabins, setSelectedCabins] = useState<string[]>(restored?.selectedCabins ?? []);
  const [selectedAircrafts, setSelectedAircrafts] = useState<string[]>(restored?.selectedAircrafts ?? []);
  const [maxPrice, setMaxPrice] = useState<number | null>(restored?.form.currency === preferredCurrency() ? restored.maxPrice : null);
  const [visibleCount, setVisibleCount] = useState(restored?.visibleCount ?? 30);
  const [selectedLegKeys, setSelectedLegKeys] = useState<string[]>(restored?.selectedLegKeys ?? []);
  const [selectedFareKeys, setSelectedFareKeys] = useState<(string | null)[]>(restored?.selectedFareKeys ?? []);
  const [fareChoice, setFareChoice] = useState<Record<string, string>>(restoreResult ? restored?.fareChoice ?? {} : {});
  const [openDetails, setOpenDetails] = useState<string | null>(restoreResult ? restored?.openDetails ?? null : null);
  const [comparedIds, setComparedIds] = useState<string[]>(restoreResult ? restored?.comparedIds ?? [] : []);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [orderRevision, setOrderRevision] = useState(0);
  const [formOffscreen, setFormOffscreen] = useState(false);
  const filterPanel = useRef<HTMLElement>(null);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  useEffect(() => { const media = window.matchMedia('(max-width: 900px)'); const update = () => { setMobile(media.matches); if (!media.matches) setFiltersOpen(false); }; media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
  useFlightDialog(filtersOpen && mobile, filterPanel, () => setFiltersOpen(false));
  const controller = useRef<AbortController | null>(null);
  const searchForm = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const form = searchForm.current;
    if (!form || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(([entry]) => setFormOffscreen(entry.boundingClientRect.bottom < 0), { threshold: 0 });
    observer.observe(form);
    return () => observer.disconnect();
  }, []);
  const dateSearchRequested = useRef(false);
  useEffect(() => {
    if (!dateSearchRequested.current) return;
    dateSearchRequested.current = false;
    const frame = requestAnimationFrame(() => searchForm.current?.requestSubmit());
    return () => cancelAnimationFrame(frame);
  }, [departureDate, returnDate]);
  const passengerPicker = useRef<HTMLDivElement>(null);
  const passengerTrigger = useRef<HTMLButtonElement>(null);
  const submitting = useRef(false);
  const selecting = useRef(false);
  const selectionKey = useRef('');
  const selectionPanel = useRef<HTMLDivElement>(null);
  const [selectedOffer, setSelectedOffer] = useState<FlightOffer | null>(null);
  const [candidates, setCandidates] = useState<TravellerProfile[]>([]);
  const [selectedTravellerIds, setSelectedTravellerIds] = useState<string[]>([]);
  const [servicePreferences, setServicePreferences] = useState<Record<string, FlightServicePreferences>>({});
  const [selectedExtras, setSelectedExtras] = useState<FlightAncillaryRequest[]>([]);
  const [selectionLoading, setSelectionLoading] = useState(false);
  const [selectionSaving, setSelectionSaving] = useState(false);
  const [selectionError, setSelectionError] = useState('');

  const passengerLabel = `${adults} ${adults === 1 ? 'adult' : 'adults'}${children ? ` · ${children} ${children === 1 ? 'child' : 'children'}` : ''}${infants ? ` · ${infants} ${infants === 1 ? 'infant' : 'infants'}` : ''}`;
  function updatePassenger(kind: 'adults' | 'children' | 'infants', delta: number) {
    if (kind === 'adults') { const next = Math.max(1, Math.min(9 - children - infants, adults + delta)); setAdults(next); if (infants > next) setInfants(next); }
    if (kind === 'children') setChildren((count) => Math.max(0, Math.min(8, count + delta, 9 - adults - infants)));
    if (kind === 'infants') setInfants((count) => Math.max(0, Math.min(adults, count + delta, 9 - adults - children)));
  }

  useEffect(() => {
    if (!tripId) return;
    let active = true;
    void tripService.detail(tripId).then((value) => {
      if (!active) return;
      setTrip(value);
      if (!restored && !params.has('departureDate')) setDepartureDate(value.startDate ?? '');
      if (!restored && !params.has('returnDate')) setReturnDate(value.endDate ?? '');
    }, () => { if (active) setTripError("We couldn't load this trip."); }).finally(() => { if (active) setTripLoading(false); });
    return () => { active = false; };
  }, [tripId, params]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!passengerPickerOpen) return;
    const dismiss = (event: MouseEvent) => { if (!passengerPicker.current?.contains(event.target as Node)) setPassengerPickerOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { setPassengerPickerOpen(false); passengerTrigger.current?.focus(); } };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('mousedown', dismiss); document.removeEventListener('keydown', onKeyDown); };
  }, [passengerPickerOpen]);
  useLayoutEffect(() => {
    if (!openDetails) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpenDetails(null); };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', onKeyDown); };
  }, [openDetails]);
  useEffect(() => {
    if (restored ? !returningSearch : !fromHomeSearch) return;
    const frame = window.requestAnimationFrame(() => searchForm.current?.requestSubmit());
    return () => window.cancelAnimationFrame(frame);
  // The homepage hands off one explicit search; later form edits must not resubmit it.
  }, []);
  useEffect(() => {
    const codes = airportCodes?airportCodes.split(','):[];
    if (!codes.length) { setStopAirports({}); return; }
    let active = true;
    void loadAirportDetails(codes).then((details) => { if (active) setStopAirports(details); }, () => { if (active) setStopAirports({}); });
    return () => { active = false; };
  }, [airportCodes]);
  const criteriaIdentity = JSON.stringify([origin, destination, departureDate, returnDate, tripType, multiLegs, adults, children, infants, cabin, currency]);
  const previousCriteria = useRef(criteriaIdentity);
  useEffect(() => {
    if (previousCriteria.current === criteriaIdentity) return;
    previousCriteria.current = criteriaIdentity;
    restoringSearch.current = false;
    scrollRestored.current = true;
    setSelectedOffer(null);
    setSelectedLegKeys([]); setSelectedFareKeys([]);
    setResult(null);
    setComparedIds([]); setComparisonOpen(false); setOpenDetails(null); setRestoredResults(false);
    if (!controller.current || controller.current.signal.aborted) return;
    controller.current.abort(); controller.current = null;
    submitting.current = false; setLoading(false);
  }, [criteriaIdentity]);
  const initialOwner = useRef(owner);
  useEffect(() => {
    if (initialOwner.current === owner) return;
    initialOwner.current = owner;
    const resume = submitting.current || !!result;
    controller.current?.abort(); controller.current = null; submitting.current = false;
    setLoading(false); setResult(null); setOpenDetails(null); setComparedIds([]); setComparisonOpen(false); setSelectedOffer(null); setRestoredResults(false);
    if (resume) {
      restoringSearch.current = true;
      const frame = requestAnimationFrame(() => searchForm.current?.requestSubmit());
      return () => cancelAnimationFrame(frame);
    }
  }, [owner]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    setError('');
    if ((tripType !== 'MULTI_CITY' && (!/^[A-Z]{3}$/.test(code(origin)) || !/^[A-Z]{3}$/.test(code(destination)) || code(origin) === code(destination) || !departureDate)) ||
      (tripType === 'ROUND_TRIP' && (!returnDate || returnDate < departureDate)) || (tripType === 'MULTI_CITY' && (multiLegs.length < 2 || multiLegs.some((leg,index) => !/^[A-Z]{3}$/.test(code(leg.origin)) || !/^[A-Z]{3}$/.test(code(leg.destination)) || code(leg.origin) === code(leg.destination) || !leg.departureDate || (index > 0 && (code(multiLegs[index - 1]!.destination) !== code(leg.origin) || multiLegs[index - 1]!.departureDate > leg.departureDate))))) || infants > adults || adults + children + infants > 9) {
      setError('Check your airports, dates and traveller counts, then try again.'); return;
    }
    if (children || infants) { setError('Live flight searches currently support adults only. Child and infant fares need age details for each passenger.'); return; }
    const routeLegs = tripType === 'MULTI_CITY' ? multiLegs.map((leg) => ({ ...leg, origin: code(leg.origin), destination: code(leg.destination) })) : undefined;
    const input: FlightSearchRequest = { origin: tripType === 'MULTI_CITY' ? routeLegs![0]!.origin : code(origin), destination: tripType === 'MULTI_CITY' ? routeLegs!.at(-1)!.destination : code(destination), departureDate: tripType === 'MULTI_CITY' ? routeLegs![0]!.departureDate : departureDate,
      ...(tripType === 'ROUND_TRIP' && { returnDate }), tripType, adults, children, infants, cabin, currency, ...(tripId && { tripId }) };
    if (routeLegs) input.legs = routeLegs;
    controller.current?.abort();
    const restoring = restoringSearch.current; restoringSearch.current = false;
    if (!restoring) scrollRestored.current = true;
    if (!restoring) { setSelectedLegKeys([]); setSelectedFareKeys([]); }
    const next = new AbortController(); controller.current = next;
    submitting.current = true; setLoading(true); setResult(null);
    setSelectedOffer(null); setRestoredResults(false); setComparedIds([]); setComparisonOpen(false);
    if (!restoring) { setSort('RECOMMENDED'); resetStageFilters(); setVisibleCount(30); }
    setFareChoice({}); setOpenDetails(null);
    let receivedFlights = false;
    try {
      await flightService.searchProgressively(input, (response) => {
        if (next.signal.aborted || controller.current !== next) return;
        receivedFlights = receivedFlights || response.offers.length > 0;
        setResult(previous=>mergeProgressiveFlightResults(previous,response));
        setVisibleCount(count=>Math.max(count,response.offers.length));
      }, { signal: next.signal });
    }
    catch (cause) {
      if (next.signal.aborted || controller.current !== next || (cause instanceof ApiClientError && cause.code === 'ABORTED')) return;
      if (receivedFlights) { setError('Some flight options could not be loaded. You can choose a fare below or search again.'); return; }
      if (cause instanceof ApiClientError && cause.code === 'RATE_LIMITED') setError('Too many searches right now. Please wait a moment.');
      else if (cause instanceof ApiClientError && cause.code === 'DEPENDENCY_UNAVAILABLE') setError('The airline connection is temporarily unavailable. Please try your search again.');
      else if (cause instanceof ApiClientError && cause.code === 'TIMEOUT') setError('The airline search is taking longer than expected. Please try again.');
      else if (cause instanceof ApiClientError && (cause.code === 'INVALID_SESSION' || cause.code === 'AUTHENTICATION_REQUIRED')) setError('Your session has expired. Please sign in again to search within your trip, or use the public flight search.');
      else setError("We couldn't refresh flights right now. Please try again.");
    } finally { if (controller.current === next) { controller.current = null; submitting.current = false; setLoading(false); } }
  }

  const totalLegs = tripType === 'MULTI_CITY' ? multiLegs.length : tripType === 'ROUND_TRIP' ? 2 : 1;
  const currentLegIndex = Math.min(selectedLegKeys.length, totalLegs - 1);
  const currentLegLabel = tripType === 'MULTI_CITY' ? `Flight ${currentLegIndex + 1}` : currentLegIndex === 0 ? 'Outbound' : 'Return';
  const stageOffers = useMemo(()=>rawOffers.filter((offer) => legOf(offer, currentLegIndex) &&
    selectedLegKeys.every((key, index) => { const leg = legOf(offer, index); return leg && flightLegKey(leg) === key && (!selectedFareKeys[index] || legFareKey(offer, index) === selectedFareKeys[index]); })),[rawOffers,currentLegIndex,selectedLegKeys,selectedFareKeys]);
  const prices = useMemo(()=>stageOffers.map((offer) => Number(offer.totalAmount)).filter(Number.isFinite),[stageOffers]);
  const highestPrice = prices.length ? Math.max(...prices) : 0;
  const airlineOptions = useMemo(() => {
    const codes = [...new Set(stageOffers.flatMap(offer => legOf(offer,currentLegIndex)!.segments.map(segment => segment.marketingCarrier)))];
    return codes.map(code => {
      const matching = stageOffers.filter(offer => legOf(offer,currentLegIndex)!.segments.some(segment => segment.marketingCarrier === code));
      return {code, label:airlineName(code) ?? code, count:uniqueFlightCount(matching,currentLegIndex), lowest:Math.min(...matching.map(offer=>Number(offer.totalAmount)))};
    }).sort((a,b)=>a.label.localeCompare(b.label));
  }, [stageOffers,currentLegIndex]);
  const airportOptions = useMemo(() => {
    const options = new Map<string, Set<string>>();
    for (const offer of stageOffers) {
      const leg = legOf(offer, currentLegIndex)!;
      for (const code of leg.segments.flatMap((segment) => [segment.origin, segment.destination])) {
        const itineraries = options.get(code) ?? new Set<string>();
        itineraries.add(flightLegKey(leg));
        options.set(code, itineraries);
      }
    }
    return [...options].map(([code, itineraries]) => ({ code, count: itineraries.size, label: stopAirports[code]?.city ? `${stopAirports[code]!.city} (${code})` : code }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [stageOffers, currentLegIndex, stopAirports]);
  const stopoverOptions = useMemo(() => {
    const options = new Map<string, Set<string>>();
    for (const offer of stageOffers) { const leg = legOf(offer, currentLegIndex)!; for (const segment of leg.segments.slice(0, -1)) {
      const itineraries = options.get(segment.destination) ?? new Set<string>();
      itineraries.add(flightLegKey(leg));
      options.set(segment.destination, itineraries);
    } }
    return [...options].map(([code, itineraries]) => ({ code, count: itineraries.size, label: stopAirports[code]?.city ? `${stopAirports[code]!.city} (${code})` : code }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [stageOffers, currentLegIndex, stopAirports]);
  const cabinOptionsFound = useMemo(() => [...new Set(stageOffers.map((offer) => offer.cabin ?? 'UNKNOWN'))]
    .map((value) => ({ value, label: value === 'UNKNOWN' ? 'Not specified' : cabinLabel(value as FlightOffer['cabin']) }))
    .sort((a, b) => a.label.localeCompare(b.label)), [stageOffers]);
  const aircraftOptions = useMemo(() => {
    const counts = new Map<string, Set<string>>();
    for (const offer of stageOffers) { const leg = legOf(offer, currentLegIndex)!; for (const segment of leg.segments) {
      if (!segment.aircraftTypeCode) continue;
      const itineraries = counts.get(segment.aircraftTypeCode) ?? new Set<string>();
      itineraries.add(flightLegKey(leg));
      counts.set(segment.aircraftTypeCode, itineraries);
    } }
    return [...counts].map(([aircraftTypeCode, itineraries]) => ({ aircraftTypeCode, count: itineraries.size }))
      .sort((a, b) => a.aircraftTypeCode.localeCompare(b.aircraftTypeCode));
  }, [stageOffers, currentLegIndex]);
  const maxFlightDuration = Math.max(0, ...stageOffers.map((offer) => durationForFilter(offer, currentLegIndex)).filter((value): value is number => value !== null && Number.isFinite(value)));
  const selectedDepartureArrival = (offer: FlightOffer) => {
    const leg = legOf(offer, currentLegIndex);
    const first = leg?.segments[0];
    const last = leg?.segments.at(-1);
    return { departure: first ? timeOfDay(first.departureAt) : null, arrival: last ? timeOfDay(last.arrivalAt) : null };
  };
  const offers = useMemo(() => {
    const rows = stageOffers.filter((offer) => (stopFilter === 'ANY' || (stopFilter === 'NONSTOP' ? legOf(offer, currentLegIndex)!.stops === 0 : stopFilter === 'ONE_OR_FEWER' ? legOf(offer, currentLegIndex)!.stops <= 1 : legOf(offer, currentLegIndex)!.stops >= 2)) &&
      (!baggageOnly || hasIncludedCheckedBaggage(offer, currentLegIndex)) &&
      (!selectedAirlines.length || legOf(offer,currentLegIndex)!.segments.some(segment => selectedAirlines.includes(segment.marketingCarrier))) &&
      (!refundableOnly || offer.penalties?.some(rule => rule.type === 'REFUND' && rule.applicability === 'BEFORE' && rule.allowed)) &&
      (!selectedStopovers.length || selectedStopovers.some((code) => legOf(offer, currentLegIndex)!.segments.slice(0, -1).some((segment) => segment.destination === code))) &&
      (!selectedAirports.length || selectedAirports.some((code) => legOf(offer, currentLegIndex)!.segments.some((segment) => segment.origin === code || segment.destination === code))) &&
      (!selectedCabins.length || selectedCabins.includes(offer.cabin ?? 'UNKNOWN')) &&
      (!selectedAircrafts.length || selectedAircrafts.some((aircraft) => legOf(offer, currentLegIndex)!.segments.some((segment) => segment.aircraftTypeCode === aircraft))) &&
      (() => { const times = selectedDepartureArrival(offer); return times.departure !== null && times.arrival !== null && times.departure >= departureWindow[0] && times.departure <= departureWindow[1] && times.arrival >= arrivalWindow[0] && times.arrival <= arrivalWindow[1]; })() &&
      (maxDuration === null || (durationForFilter(offer, currentLegIndex) !== null && durationForFilter(offer, currentLegIndex)! <= maxDuration)) &&
      (maxPrice === null || Number(offer.totalAmount) <= maxPrice));
    if (sort === 'CHEAPEST') return [...rows].sort((a, b) => Number(a.totalAmount) - Number(b.totalAmount));
    if (sort === 'FASTEST') return [...rows].sort((a, b) => (durationForFilter(a, currentLegIndex) ?? Infinity) - (durationForFilter(b, currentLegIndex) ?? Infinity));
    if (sort === 'DIRECT_FIRST') return [...rows].sort((a,b)=>legOf(a,currentLegIndex)!.stops-legOf(b,currentLegIndex)!.stops || Number(a.totalAmount)-Number(b.totalAmount));
    if (sort === 'EARLIEST') return [...rows].sort((a,b)=>(selectedDepartureArrival(a).departure??Infinity)-(selectedDepartureArrival(b).departure??Infinity));
    return rows;
  }, [stageOffers, currentLegIndex, stopFilter, baggageOnly, selectedAirlines, refundableOnly, selectedStopovers, selectedAirports, selectedCabins, selectedAircrafts, departureWindow, arrivalWindow, maxDuration, maxPrice, sort]);
  const fareGroups = useMemo(() => {
    const groups = new Map<string, FlightOffer[]>();
    for (const offer of offers) {
      const key = flightLegKey(legOf(offer, currentLegIndex)!);
      const fares = groups.get(key);
      if (fares) fares.push(offer); else groups.set(key, [offer]);
    }
    return [...groups].map(([key, fares]) => ({ key, fares: fares.sort((a, b) => Number(a.totalAmount) - Number(b.totalAmount)) }));
  }, [offers, currentLegIndex]);
  const filterSignature = JSON.stringify([result?.searchId, currentLegIndex, selectedLegKeys, selectedFareKeys, sort, stopFilter, baggageOnly, refundableOnly, selectedAirlines, selectedStopovers, selectedAirports, selectedCabins, selectedAircrafts, departureWindow, arrivalWindow, maxDuration, maxPrice, orderRevision]);
  const stableGroups = useStableFlightGroups(fareGroups, filterSignature, restored?.displayKeys);
  const comparedOffers = useMemo(() => comparedIds.flatMap(id => { const fare = rawOffers.find(offer => offer.offerId === id); return fare ? [fare] : []; }), [comparedIds, rawOffers]);
  useEffect(() => { setComparedIds(ids => { const available = new Set(rawOffers.map(offer => offer.offerId)); const next = ids.filter(id => available.has(id)); return next.length === ids.length ? ids : next; }); }, [rawOffers]);
  const toggleComparison = useCurrentCallback((id: string) => setComparedIds(ids => ids.includes(id) ? ids.filter(value => value !== id) : ids.length < 3 ? [...ids, id] : ids));
  const browseRef = useRef<FlightBrowseSnapshot | null>(null);
  useLayoutEffect(() => {
    browseRef.current = { owner, publicSearch, savedAt: Date.now(), form: { origin, destination, departureDate, returnDate, tripType, multiLegs, adults, children, infants, cabin, currency }, result, wasLoading: loading, sort, stopFilter, baggageOnly, refundableOnly, selectedAirlines, selectedStopovers, selectedAirports, selectedCabins, selectedAircrafts, departureWindow, arrivalWindow, maxDuration, maxPrice, airlineQuery, airlinesExpanded, visibleCount, selectedLegKeys, selectedFareKeys, fareChoice, openDetails, comparedIds, displayKeys: stableGroups.keys, scrollY: window.scrollY, anchorKey: null, anchorOffset: 0 };
  });
  useLayoutEffect(() => {
    const save = () => {
      if (!browseRef.current) return;
      const anchor = [...document.querySelectorAll<HTMLElement>('[data-flight-group]')].find(element => { const rect = element.getBoundingClientRect(); return rect.bottom > 0 && rect.top < window.innerHeight; });
      rememberFlightBrowse(location.key, { ...browseRef.current, route: { pathname: location.pathname, search: location.search }, scrollY: window.scrollY, savedAt: Date.now(), anchorKey: anchor?.dataset.flightGroup ?? null, anchorOffset: anchor?.getBoundingClientRect().top ?? 0 });
    };
    window.addEventListener('pagehide', save);
    return () => { save(); window.removeEventListener('pagehide', save); };
  }, [location.key, location.pathname, location.search]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (browseRef.current) rememberFlightBrowse(location.key, { ...browseRef.current, route: { pathname: location.pathname, search: location.search } });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [location.key, location.pathname, location.search, result, criteriaIdentity, filterSignature, fareChoice, openDetails, comparedIds, visibleCount]);
  const scrollRestored = useRef(false);
  useEffect(() => {
    if (!restored || scrollRestored.current || !result?.offers.length) return;
    let settleFrame = 0;
    const frame = requestAnimationFrame(() => {
      const anchor = [...document.querySelectorAll<HTMLElement>('[data-flight-group]')].find(element => element.dataset.flightGroup === restored.anchorKey);
      if (!anchor) { window.scrollTo({ top: restored.scrollY, behavior: 'instant' }); scrollRestored.current = true; return; }
      anchor.scrollIntoView({ block: 'start', behavior: 'instant' });
      settleFrame = requestAnimationFrame(() => { window.scrollBy({ top: anchor.getBoundingClientRect().top - restored.anchorOffset, behavior: 'instant' }); scrollRestored.current = true; });
    });
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(settleFrame); };
  }, [result, restored]);

  function resetStageFilters() {
    setStopFilter('ANY'); setBaggageOnly(false);
    setSelectedAirlines([]); setRefundableOnly(false); setAirlineQuery(''); setAirlinesExpanded(false);
    setDepartureWindow([0, 1440]); setArrivalWindow([0, 1440]);
    setMaxDuration(null); setSelectedStopovers([]); setSelectedAirports([]);
    setSelectedCabins([]); setSelectedAircrafts([]); setMaxPrice(null);
  }

  function chooseLeg(offer: FlightOffer, preserveFare = false) {
    const leg = legOf(offer, currentLegIndex);
    if (!leg || currentLegIndex >= totalLegs - 1) return;
    if (!result || Date.parse(result.expiresAt) <= Date.now()) { setOpenDetails(null); setError('This search has expired. Refresh flights to see current fares.'); return; }
    setSelectedLegKeys((keys) => [...keys.slice(0, currentLegIndex), flightLegKey(leg)]);
    setSelectedFareKeys(keys => [...keys.slice(0, currentLegIndex), preserveFare ? legFareKey(offer, currentLegIndex) : null]);
    setOpenDetails(null); setFareChoice({}); setVisibleCount(30);
    setComparisonOpen(false); setComparedIds([]);
    resetStageFilters();
    document.querySelector('.flight-results')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  async function chooseOffer(offer: FlightOffer) {
    if (!result || selectionLoading) return;
    if (Date.parse(result.expiresAt) <= Date.now()) { setOpenDetails(null); setComparisonOpen(false); setError('This search has expired. Refresh flights to see current fares.'); return; }
    if (publicSearch) {
      const searchRequest: FlightSearchRequest = { origin: tripType === 'MULTI_CITY' ? code(multiLegs[0]!.origin) : code(origin),
        destination: tripType === 'MULTI_CITY' ? code(multiLegs.at(-1)!.destination) : code(destination),
        departureDate: tripType === 'MULTI_CITY' ? multiLegs[0]!.departureDate : departureDate, tripType,
        ...(tripType === 'ROUND_TRIP' && { returnDate }), adults, children, infants, cabin, currency,
        ...(tripId && { tripId }), ...(tripType === 'MULTI_CITY' && { legs: multiLegs.map((leg) => ({ ...leg, origin: code(leg.origin), destination: code(leg.destination) })) }) };
      navigate('/flight-checkout', { state: { offer, searchRequest, searchId: result.searchId,
        returnTo: { pathname: location.pathname, search: flightBrowseSearchQuery(searchRequest), key: location.key } } });
      return;
    }
    setSelectedOffer(offer); setSelectionError(''); setSelectionLoading(true); setSelectedTravellerIds([]); setServicePreferences({}); setSelectedExtras([]);
    selectionKey.current = randomUUID();
    const revealSelection = () => {
      selectionPanel.current?.scrollIntoView?.({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 'auto' : 'smooth', block: 'start' });
      selectionPanel.current?.focus({ preventScroll: true });
    };
    if (window.requestAnimationFrame) window.requestAnimationFrame(revealSelection);
    else window.setTimeout(revealSelection, 0);
    try {
      const all = await travellerService.list();
      const available = tripId && trip ? all.filter((person) => trip.travellers.some((item) => item.id === person.id)) : all;
      setCandidates(available);
      if (available.length === adults + children + infants) setSelectedTravellerIds(available.map((person) => person.id));
    } catch { setSelectionError("We couldn't load your travellers. Please try again."); }
    finally { setSelectionLoading(false); }
  }

  const updateFare = useCurrentCallback((key: string, offer: FlightOffer) => setFareChoice(choices => ({ ...choices, [key]: offer.offerId })));
  const showDetails = useCurrentCallback((key: string) => { setComparisonOpen(false); setOpenDetails(current => current === key ? null : key); });
  const closeDetails = useCurrentCallback(() => setOpenDetails(null));
  const selectLeg = useCurrentCallback(chooseLeg);
  const selectFare = useCurrentCallback((offer: FlightOffer) => { setOpenDetails(null); setComparisonOpen(false); void chooseOffer(offer); });

  async function createSelection() {
    if (selecting.current || !result || !selectedOffer) return;
    if (selectedTravellerIds.length !== adults + children + infants) {
      setSelectionError(`Choose ${adults + children + infants} ${adults + children + infants === 1 ? 'traveller' : 'travellers'} for this flight.`); return;
    }
    selecting.current = true; setSelectionSaving(true); setSelectionError('');
    try {
      const intent = await flightService.createIntent({ searchId: result.searchId, offerId: selectedOffer.offerId,
        ancillarySelections: await refreshAncillarySelections({ searchId: result.searchId, offerId: selectedOffer.offerId, passengers: selectedTravellerIds.map(id => { const person = candidates.find(person => person.id === id); return { givenName: selectedOffer.ndcContext ? [person?.legalFirstName, person?.legalMiddleName].filter(Boolean).join(' ') : '', surname: selectedOffer.ndcContext ? person?.legalLastName ?? '' : '' }; }) }, selectedExtras),
        ...(tripId && { tripId }), travellerIds: selectedTravellerIds, idempotencyKey: selectionKey.current,
        serviceRequests: selectedTravellerIds.flatMap(travellerId => {
          const value = servicePreferences[travellerId];
          return value && hasServiceRequest(value) ? [{ ...value, note: value.note.trim(), travellerId }] : [];
        }) });
      navigate(`/app/flights/booking-intents/${intent.id}`, { state: { checkLatestFare: true,
        returnTo: { pathname: location.pathname, search: flightBrowseSearchQuery({
          origin: code(tripType === 'MULTI_CITY' ? multiLegs[0]!.origin : origin),
          destination: code(tripType === 'MULTI_CITY' ? multiLegs.at(-1)!.destination : destination),
          departureDate, returnDate, tripType, adults, children, infants, cabin, currency, tripId,
          ...(tripType === 'MULTI_CITY' ? { legs: multiLegs.map(leg => ({ ...leg, origin: code(leg.origin), destination: code(leg.destination) })) } : {}),
        }), key: location.key } } });
    } catch (cause) {
      setSelectionError(cause instanceof ApiClientError && cause.code === 'OFFER_EXPIRED'
        ? 'This search has expired. Refresh the latest flights.' : cause instanceof ApiClientError && cause.code === 'VALIDATION_ERROR'
          ? cause.message : "We couldn't save this flight selection. Please try again.");
    } finally { selecting.current = false; setSelectionSaving(false); }
  }

  const filtersActive = stopFilter !== 'ANY' || baggageOnly || refundableOnly || selectedAirlines.length > 0 || selectedStopovers.length > 0 || selectedAirports.length > 0 || selectedCabins.length > 0 || selectedAircrafts.length > 0 || departureWindow[0] > 0 || departureWindow[1] < 1440 || arrivalWindow[0] > 0 || arrivalWindow[1] < 1440 || maxDuration !== null || maxPrice !== null;
  const activeFilters = [
    ...selectedAirlines.map(value => ({ label: airlineName(value) ?? value, clear: () => setSelectedAirlines(items => items.filter(item => item !== value)) })),
    ...selectedStopovers.map(value => ({ label: `Via ${value}`, clear: () => setSelectedStopovers(items => items.filter(item => item !== value)) })),
    ...selectedAirports.map(value => ({ label: `Airport ${value}`, clear: () => setSelectedAirports(items => items.filter(item => item !== value)) })),
    ...selectedCabins.map(value => ({ label: cabinLabel(value as FlightOffer['cabin']), clear: () => setSelectedCabins(items => items.filter(item => item !== value)) })),
    ...selectedAircrafts.map(value => ({ label: `Aircraft ${value}`, clear: () => setSelectedAircrafts(items => items.filter(item => item !== value)) })),
    ...(baggageOnly ? [{ label: 'Checked baggage included', clear: () => setBaggageOnly(false) }] : []),
    ...(refundableOnly ? [{ label: 'Refundable before departure', clear: () => setRefundableOnly(false) }] : []),
    ...(stopFilter !== 'ANY' ? [{ label: stopFilter === 'NONSTOP' ? 'Direct only' : stopFilter === 'ONE_OR_FEWER' ? 'Up to 1 stop' : '2+ stops', clear: () => setStopFilter('ANY') }] : []),
    ...(departureWindow[0] > 0 || departureWindow[1] < 1440 ? [{ label: `Depart ${clockLabel(departureWindow[0])}–${clockLabel(departureWindow[1])}`, clear: () => setDepartureWindow([0, 1440]) }] : []),
    ...(arrivalWindow[0] > 0 || arrivalWindow[1] < 1440 ? [{ label: `Arrive ${clockLabel(arrivalWindow[0])}–${clockLabel(arrivalWindow[1])}`, clear: () => setArrivalWindow([0, 1440]) }] : []),
    ...(maxDuration !== null ? [{ label: `Up to ${minutes(maxDuration)}`, clear: () => setMaxDuration(null) }] : []),
    ...(maxPrice !== null ? [{ label: `Up to ${money(String(maxPrice), currency)}`, clear: () => setMaxPrice(null) }] : []),
  ];
  const editSearch = () => { setFiltersOpen(false); searchForm.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); searchForm.current?.querySelector<HTMLInputElement>('input:not([type="radio"]):not([type="hidden"])')?.focus({ preventScroll: true }); };
  const summaryFrom = code(tripType === 'MULTI_CITY' ? multiLegs[0]?.origin ?? '' : origin);
  const summaryTo = code(tripType === 'MULTI_CITY' ? multiLegs.at(-1)?.destination ?? '' : destination);
  const stageLeg = stageOffers[0] ? legOf(stageOffers[0],currentLegIndex) : undefined;
  const cityLabel = (value:string) => stopAirports[value]?.city ?? value;
  return <div className="account-page flight-page flight-search-organized">
    {formOffscreen && <div className="flight-search-summary"><div><strong>{summaryFrom || 'From'} <span aria-hidden="true">→</span> {summaryTo || 'To'}</strong><span>{tripType === 'MULTI_CITY' ? `${multiLegs.length} flights` : travelDate(departureDate)}{tripType === 'ROUND_TRIP' ? ` – ${travelDate(returnDate)}` : ''}<span className="flight-summary-passengers"> · {passengerLabel} · {cabinLabel(cabin)}</span></span></div><button type="button" onClick={editSearch}>Edit search</button></div>}
    {tripId && <div className="flight-trip-context">{tripLoading ? 'Loading your trip…' : tripError || <><span>Searching for {trip?.title || 'your trip'} · Choose the people taking this flight{trip?.travellerCount ? ` from your ${trip.travellerCount} trip travellers` : ''}.</span><Link to={`/app/trips/${tripId}`}>Back to trip →</Link></>}</div>}
    <form ref={searchForm} className="account-panel flight-search-form" onSubmit={(event) => { void submit(event); }}>
      <fieldset className="flight-type-toggle" aria-label="Trip type"><legend className="sr-only">Trip type</legend>{([['ONE_WAY','One-way'],['ROUND_TRIP','Return'],['MULTI_CITY','Multi-city']] as const).map(([value,label]) => <label key={value}><input type="radio" name="flight-trip-type" checked={tripType === value} onChange={() => setTripType(value)} /><span>{label}</span></label>)}</fieldset>
      <div className={`flight-query-fields${tripType === 'MULTI_CITY' ? ' is-multi-city' : tripType === 'ONE_WAY' ? ' is-one-way' : ''}`}>
        {tripType === 'MULTI_CITY' ? <div className="flight-multi-legs">{multiLegs.map((leg,index) => <div className="flight-multi-leg" key={index}><b>{index + 1}</b><AirportPicker label="From" value={leg.origin} onChange={(value) => setMultiLegs((items) => items.map((item,i) => i === index ? { ...item, origin: value } : item))} /><AirportPicker label="To" value={leg.destination} onChange={(value) => setMultiLegs((items) => items.map((item,i) => i === index ? { ...item, destination: value } : i === index + 1 ? { ...item, origin: code(value) } : item))} /><CalendarDateField label={`Flight ${index + 1} date`} className="flight-leg-date" minDate={index ? multiLegs[index - 1]!.departureDate : undefined} value={leg.departureDate} onChange={(departureDate) => setMultiLegs((items) => items.map((item,i) => i === index ? { ...item, departureDate } : item))} />{multiLegs.length > 2 && <button type="button" onClick={() => setMultiLegs((items) => items.filter((_,i) => i !== index))} aria-label={`Remove flight ${index + 1}`}>×</button>}</div>)}{multiLegs.length < 6 && <button type="button" className="flight-add-leg" onClick={() => setMultiLegs((items) => [...items, { origin: code(items.at(-1)!.destination), destination: '', departureDate: '' }])}>＋ Add another flight</button>}</div> : <>
          <div className="flight-query-route"><AirportPicker label="From" value={origin} onChange={setOrigin} /><button type="button" className="flight-query-swap" aria-label="Swap airports" onClick={() => { setOrigin(destination); setDestination(origin); }}>⇄</button><AirportPicker label="To" value={destination} onChange={setDestination} /></div>
          <div className={`flight-query-dates${tripType === 'ONE_WAY' ? ' one-way' : ''}`}><CalendarDateField label="Departure" className="flight-query-date-field" value={departureDate} onChange={(next) => { setDepartureDate(next); if (returnDate && returnDate < next) setReturnDate(''); }} />{tripType === 'ROUND_TRIP' && <CalendarDateField label="Return" className="flight-query-date-field" align="end" minDate={departureDate || undefined} value={returnDate} onChange={setReturnDate} />}</div>
        </>}
        <div className="flight-passenger-control" ref={passengerPicker}>
          <button ref={passengerTrigger} type="button" className="flight-passenger-trigger" aria-haspopup="dialog" aria-expanded={passengerPickerOpen} onClick={() => setPassengerPickerOpen((open) => !open)}><span className="flight-passenger-icon" aria-hidden="true">♙</span><span>{passengerLabel}<small>{cabinOptions.find((option) => option.value === cabin)?.label ?? 'Economy'}</small></span><span className="flight-passenger-chevron" aria-hidden="true">⌄</span></button>
          {passengerPickerOpen && <section className="flight-passenger-popover" role="dialog" aria-label="Passengers and cabin"><div className="flight-passenger-popover-head"><strong>{passengerLabel}</strong><span>{cabinOptions.find((option) => option.value === cabin)?.label}</span></div><p>Please select the exact number of passengers.</p>
            {[{ key: 'adults' as const, label: 'Adults', age: '12+ years old', count: adults, min: 1, max: 9 - children - infants },{ key: 'children' as const, label: 'Children', age: '2–11 years old', count: children, min: 0, max: Math.min(8, 9 - adults - infants) },{ key: 'infants' as const, label: 'Infants on lap', age: 'Under 2 years old', count: infants, min: 0, max: Math.min(adults, 9 - adults - children) }].map((item) => <div className="flight-passenger-row" key={item.key}><span><strong>{item.label}</strong><small>{item.age}</small></span><div><button type="button" aria-label={`Remove ${item.label.toLowerCase()}`} disabled={item.count <= item.min} onClick={() => updatePassenger(item.key, -1)}>−</button><output aria-label={item.label}>{item.count}</output><button type="button" aria-label={`Add ${item.label.toLowerCase()}`} disabled={item.count >= item.max} onClick={() => updatePassenger(item.key, 1)}>＋</button></div></div>)}
            <label className="flight-passenger-cabin">Cabin<select value={cabin} onChange={(event) => setCabin(event.target.value as FlightCabin)}>{cabinOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><button type="button" className="flight-passenger-done" onClick={() => { setPassengerPickerOpen(false); passengerTrigger.current?.focus(); }}>Done</button>
          </section>}
        </div>
        <button className="btn-primary account-submit flight-query-submit" type="submit" disabled={loading || tripLoading || !!tripError}>{loading ? 'Searching…' : '⌕ Search'}</button>
      </div>
      <input type="hidden" name="currency" value={currency} />
    </form>
    {departureDate && tripType !== 'MULTI_CITY' && <FlightDateStrip departureDate={departureDate} returnDate={tripType==='ROUND_TRIP'?returnDate:undefined} criteriaKey={JSON.stringify([code(origin),code(destination),tripType,adults,children,infants,cabin,currency])} result={result} busy={loading} onChoose={(depart,returning)=>{dateSearchRequested.current=true;setDepartureDate(depart);if(returning)setReturnDate(returning);}}/>}
    {error && <div role="alert" className="account-error flight-error">{error} {!loading && <button type="button" className="account-outline-button" onClick={() => searchForm.current?.requestSubmit()}>Retry search</button>}</div>}
    {loading && (!result || !result.offers.length) && <FlightSearchSkeleton/>}
    {loading && result && result.offers.length>0 && <div className="flight-search-progress" role="status"><span className="flight-search-progress-spinner" aria-hidden="true" />{uniqueFlightCount(result.offers,currentLegIndex)} flights available. More fares are arriving—you can select a flight now.</div>}
    {result?.incomplete && !error && <p className="flight-search-notice" role="status">Some fare and cabin options could not be loaded. You can choose an available fare or search again.</p>}
    {result && (!loading || result.offers.length>0) && <section className="flight-results" aria-label="Flight results">
      {result.offers.length > 0 && totalLegs > 1 && <div className="flight-leg-progress" aria-label="Flight selection progress">
        <div className="flight-leg-progress-head"><strong>Build your trip</strong><span>Choose each flight, then choose a fare for the complete trip.</span></div>
        <div className="flight-leg-progress-steps">{Array.from({ length: totalLegs }, (_, index) => {
          const chosen = index < selectedLegKeys.length;
          const selectedLeg = chosen ? legOf(stageOffers[0]!, index) : null;
          const leg = tripType === 'MULTI_CITY' ? multiLegs[index] : { origin: index === 0 ? origin : destination, destination: index === 0 ? destination : origin, departureDate: index === 0 ? departureDate : returnDate };
          return <button key={index} type="button" className={`flight-leg-progress-step${chosen ? ' is-chosen' : ''}${index === currentLegIndex ? ' is-current' : ''}`} disabled={!chosen} onClick={() => { setSelectedLegKeys((keys) => keys.slice(0, index)); setSelectedFareKeys(keys => keys.slice(0, index)); setOpenDetails(null); setFareChoice({}); resetStageFilters(); }}>
            <b>{chosen ? '✓' : index + 1}</b><span><strong>{tripType === 'MULTI_CITY' ? `Flight ${index + 1}` : index === 0 ? 'Outbound' : 'Return'}</strong><small>{selectedLeg ? `${selectedLeg.segments[0]?.origin} → ${selectedLeg.segments.at(-1)?.destination} · ${selectedLeg.segments[0]?.marketingCarrier} ${selectedLeg.segments[0]?.flightNumber}` : `${code(leg?.origin ?? '')} → ${code(leg?.destination ?? '')} · ${leg?.departureDate ?? ''}`}</small></span>
          </button>;
        })}</div>
      </div>}
      {selectedOffer && <div className="account-panel flight-selection" aria-label="Select flight travellers" ref={selectionPanel} tabIndex={-1}>
        <div className="flight-selection-head"><div><p className="account-eyebrow">YOUR FLIGHT</p><h3>Who is taking this flight?</h3><p className="account-muted">Choose {adults + children + infants} from your saved travellers. This selection is not a booking.</p></div><button type="button" className="account-outline-button" onClick={() => setSelectedOffer(null)}>Choose another flight</button></div>
        <div className="flight-selected-summary"><AirlineIdentity codes={selectedOffer.airlineCodes} /><span>{(selectedOffer.multiCityLegs ?? [selectedOffer.outbound, ...(selectedOffer.inbound ? [selectedOffer.inbound] : [])]).map((leg) => `${leg.segments[0]?.origin} → ${leg.segments.at(-1)?.destination}`).join(' · ')} · {money(selectedOffer.totalAmount, selectedOffer.currency)}</span></div>
        {selectionLoading ? <TravellerSelectionSkeleton/> : <div className="flight-traveller-list">{candidates.map((person) => <label key={person.id}><input type="checkbox" checked={selectedTravellerIds.includes(person.id)} disabled={selectionSaving} onChange={(event) => { selectionKey.current = randomUUID(); setSelectedExtras([]); setSelectedTravellerIds((ids) => event.target.checked ? [...ids, person.id] : ids.filter((id) => id !== person.id)); }} /><span>{[person.legalFirstName, person.legalMiddleName, person.legalLastName].filter(Boolean).join(' ')}</span></label>)}{candidates.length === 0 && <p>Add a traveller profile to check this fare.</p>}</div>}
        <Link to="/app/travellers" className="flight-add-traveller">+ Add a traveller</Link>{selectionError && <p role="alert" className="account-error">{selectionError}</p>}
        {selectedTravellerIds.length > 0 && <section className="flight-selection-services" aria-label="Meals, baggage and assistance">
          <h3>Meals, baggage &amp; assistance</h3>
          <p className="account-muted">Add optional requests for each traveler. Availability and any extra cost require airline confirmation.</p>
          <FlightAirlineServices searchId={result.searchId} offerId={selectedOffer.offerId} selectedExtras={selectedExtras} disabled={selectionSaving} onSelectedExtrasChange={extras => { if (selecting.current) return; selectionKey.current = randomUUID(); setSelectedExtras(extras); }} requireNames={!!selectedOffer.ndcContext} ready={selectedTravellerIds.length === adults + children + infants}
            passengers={selectedTravellerIds.map(id => { const person = candidates.find(person => person.id === id); return { givenName: [person?.legalFirstName, person?.legalMiddleName].filter(Boolean).join(' '), surname: person?.legalLastName ?? '' }; })} />
          {selectedTravellerIds.map(id => {
            const person = candidates.find(candidate => candidate.id === id);
            return <FlightServiceRequestFields key={id} label={person ? [person.legalFirstName, person.legalLastName].join(' ') : 'Traveler'}
              value={servicePreferences[id] ?? emptyServicePreferences()} disabled={selectionSaving}
              onChange={update => { if (selecting.current) return; selectionKey.current = randomUUID(); setServicePreferences(current => ({ ...current, [id]: { ...(current[id] ?? emptyServicePreferences()), ...update } })); }} />;
          })}
        </section>}
        <button type="button" className="btn-primary account-submit" disabled={selectionLoading || selectionSaving || selectedTravellerIds.length !== adults + children + infants} onClick={() => { void createSelection(); }}>{selectionSaving ? 'Saving your selection…' : 'Check latest fare'}</button>
      </div>}
      <div className="flight-results-layout">

      {filtersOpen && mobile && <div className="flight-filter-backdrop" onClick={() => setFiltersOpen(false)} aria-hidden="true"/>}
      <aside ref={filterPanel} id="flight-filters" className={`account-panel flight-filter-sidebar${filtersOpen?' is-open':''}`} role={filtersOpen && mobile ? 'dialog' : undefined} aria-modal={filtersOpen && mobile ? true : undefined} tabIndex={-1} aria-label="Filter flights">
        <div className="flight-filter-heading"><h3>Filter flights{mobile && activeFilters.length > 0 && <small>{activeFilters.length} selected</small>}</h3><div><button type="button" disabled={!filtersActive} onClick={resetStageFilters}>Reset all</button><button type="button" className="flight-filter-close" aria-label="Close filters" onClick={() => setFiltersOpen(false)}>×</button></div></div>
        <div className="flight-filter-content">
        <details className="flight-filter-section" open><summary>Quick filters</summary>
          <label className="flight-filter-check"><input type="checkbox" checked={stopFilter==='NONSTOP'} onChange={event=>setStopFilter(event.target.checked?'NONSTOP':'ANY')}/><span>Direct flights only</span><small>{uniqueFlightCount(stageOffers.filter(offer=>legOf(offer,currentLegIndex)!.stops===0),currentLegIndex)}</small></label>
          <label className="flight-filter-check"><input type="checkbox" checked={baggageOnly} onChange={event=>setBaggageOnly(event.target.checked)}/><span>Checked baggage included</span></label>
          {stageOffers.some(offer=>offer.penalties?.some(rule=>rule.type==='REFUND'&&rule.applicability==='BEFORE'&&rule.allowed))&&<label className="flight-filter-check"><input type="checkbox" checked={refundableOnly} onChange={event=>setRefundableOnly(event.target.checked)}/><span>Refundable before departure</span></label>}
        </details>
        <details className="flight-filter-section" open><summary>Airlines <small>{selectedAirlines.length?`${selectedAirlines.length} selected`:'All'}</small></summary>
          {airlineOptions.length>5&&<input className="flight-airline-search" type="search" aria-label="Find an airline" placeholder="Find an airline" value={airlineQuery} onChange={event=>setAirlineQuery(event.target.value)}/>}
          <div id="flight-airline-options" className="flight-airline-filters">{airlineOptions.filter((option,index)=>(airlinesExpanded||airlineQuery.trim()||index<5||selectedAirlines.includes(option.code))&&`${option.label} ${option.code}`.toLowerCase().includes(airlineQuery.trim().toLowerCase())).map(option=><label className="flight-filter-check" key={option.code}><input type="checkbox" checked={selectedAirlines.includes(option.code)} onChange={event=>setSelectedAirlines(current=>event.target.checked?[...current,option.code]:current.filter(code=>code!==option.code))}/><span>{option.label}<small>{option.count} {option.count===1?'flight':'flights'}</small></span><small>{money(String(option.lowest),stageOffers[0]?.currency??currency)}</small></label>)}</div>
          {!airlineQuery.trim()&&airlineOptions.length>5&&<button className="flight-filter-expand" type="button" aria-expanded={airlinesExpanded} aria-controls="flight-airline-options" onClick={()=>setAirlinesExpanded(value=>!value)}>{airlinesExpanded?'Show fewer airlines':`Show all ${airlineOptions.length} airlines`} <span aria-hidden="true">{airlinesExpanded?'⌃':'⌄'}</span></button>}
          {airlineQuery.trim()&&!airlineOptions.some(option=>`${option.label} ${option.code}`.toLowerCase().includes(airlineQuery.trim().toLowerCase()))&&<p className="flight-filter-unavailable">No airlines match your search.</p>}
        </details>
        <details className="flight-filter-section"><summary>Times</summary>
          <TimeWindowFilter label="Departure time" value={departureWindow} onChange={setDepartureWindow} />
          <TimeWindowFilter label="Arrival time" value={arrivalWindow} onChange={setArrivalWindow} />
        </details>
        <details className="flight-filter-section"><summary>Duration <small>{maxDuration === null ? 'Any' : `Up to ${minutes(maxDuration)}`}</small></summary>
          <label className="flight-filter-select-label" htmlFor="flight-duration">Maximum travel time</label><select id="flight-duration" className="flight-filter-select" value={maxDuration ?? ''} onChange={(event) => setMaxDuration(event.target.value ? Number(event.target.value) : null)}><option value="">Any duration</option>{[...new Set([...([6, 9, 12, 15, 18, 24, 36, 48].map((hours) => hours * 60).filter((value) => value < maxFlightDuration)), maxFlightDuration].filter((value) => value > 0))].sort((a, b) => a - b).map((value) => <option key={value} value={value}>Up to {minutes(value)}</option>)}</select>
        </details>
        <details className="flight-filter-section" open><summary>Stops <small>{stopFilter === 'ANY' ? 'Any' : stopFilter === 'NONSTOP' ? 'Nonstop' : stopFilter === 'ONE_OR_FEWER' ? '1 stop or fewer' : '2 or more'}</small></summary>
          {([{value:'ANY',label:'Any number of stops',count:uniqueFlightCount(stageOffers,currentLegIndex)},{value:'NONSTOP',label:'Nonstop',count:uniqueFlightCount(stageOffers.filter((offer) => legOf(offer,currentLegIndex)!.stops === 0),currentLegIndex)},{value:'ONE_OR_FEWER',label:'1 stop or fewer',count:uniqueFlightCount(stageOffers.filter((offer) => legOf(offer,currentLegIndex)!.stops <= 1),currentLegIndex)},{value:'TWO_OR_MORE',label:'2 or more stops',count:uniqueFlightCount(stageOffers.filter((offer) => legOf(offer,currentLegIndex)!.stops >= 2),currentLegIndex)}] as const).map((option) => <label className="flight-filter-check" key={option.value}><input type="radio" name="flight-stops" checked={stopFilter === option.value} onChange={() => setStopFilter(option.value)} /><span>{option.label}</span><small>{option.count}</small></label>)}
        </details>
        <details className="flight-filter-section"><summary>Stopover cities <small>{selectedStopovers.length ? `${selectedStopovers.length} selected` : 'Any'}</small></summary>
          {stopoverOptions.length ? <div className="flight-filter-options">{stopoverOptions.map((option) => <label className="flight-filter-check" key={option.code}><input type="checkbox" checked={selectedStopovers.includes(option.code)} onChange={(event) => setSelectedStopovers((current) => event.target.checked ? [...current, option.code] : current.filter((item) => item !== option.code))} /><span>{option.label}</span><small>{option.count}</small></label>)}</div> : <p className="flight-filter-unavailable">No stopover cities in these results.</p>}
        </details>
        <details className="flight-filter-section"><summary>Airports <small>{selectedAirports.length ? `${selectedAirports.length} selected` : 'Any'}</small></summary>
          <div className="flight-filter-options">{airportOptions.map((option) => <label className="flight-filter-check" key={option.code}><input type="checkbox" checked={selectedAirports.includes(option.code)} onChange={(event) => setSelectedAirports((current) => event.target.checked ? [...current, option.code] : current.filter((item) => item !== option.code))} /><span>{option.label}</span><small>{option.count}</small></label>)}</div>
        </details>
        <details className="flight-filter-section"><summary>Aircraft <small>{selectedAircrafts.length ? `${selectedAircrafts.length} selected` : aircraftOptions.length ? `${aircraftOptions.length} types` : 'Unavailable'}</small></summary>
          {aircraftOptions.length ? <div className="flight-filter-options">{aircraftOptions.map((option) => <label className="flight-filter-check" key={option.aircraftTypeCode}><input type="checkbox" checked={selectedAircrafts.includes(option.aircraftTypeCode)} onChange={(event) => setSelectedAircrafts((current) => event.target.checked ? [...current, option.aircraftTypeCode] : current.filter((item) => item !== option.aircraftTypeCode))} /><span>{option.aircraftTypeCode}</span><small>{option.count}</small></label>)}</div> : <p className="flight-filter-unavailable">Aircraft type wasn’t included in these flight results.</p>}
        </details>
        <details className="flight-filter-section"><summary>Cabin <small>{selectedCabins.length ? `${selectedCabins.length} selected` : cabinOptionsFound.length === 1 ? cabinOptionsFound[0]!.label : 'Any'}</small></summary>
          <div className="flight-filter-options">{cabinOptionsFound.map((option) => { const count = uniqueFlightCount(stageOffers.filter((offer) => (offer.cabin ?? 'UNKNOWN') === option.value),currentLegIndex); return <label className="flight-filter-check" key={option.value}><input type="checkbox" checked={selectedCabins.includes(option.value)} onChange={(event) => setSelectedCabins((current) => event.target.checked ? [...current, option.value] : current.filter((item) => item !== option.value))} /><span>{option.label}</span><small>{count}</small></label>; })}</div>
        </details>
        {highestPrice > 0 && <div className="flight-filter-section"><div className="flight-filter-section-title"><h3>Maximum price</h3><button type="button" onClick={() => setMaxPrice(null)}>Reset</button></div><strong className="flight-filter-price">{money(String(maxPrice ?? highestPrice), rawOffers[0]?.currency ?? currency)}</strong><input className="flight-price-range" type="range" min={Math.min(...prices)} max={highestPrice} step="any" value={maxPrice ?? highestPrice} onChange={(event) => setMaxPrice(Number(event.target.value))} aria-label="Maximum flight price" /></div>}
        {filtersActive && <button className="flight-clear-filters" type="button" onClick={resetStageFilters}>Clear filters</button>}
        </div>
        <div className="flight-filter-apply"><button type="button" className="btn-primary" onClick={() => setFiltersOpen(false)}>Show {fareGroups.length} {fareGroups.length === 1 ? 'flight' : 'flights'}</button></div>
      </aside>
      <div className="flight-results-column"><div className="flight-results-head"><div><p className="account-eyebrow">{currentLegLabel.toUpperCase()} FLIGHTS</p><h2>{stageLeg?`${cityLabel(stageLeg.segments[0]!.origin)} → ${cityLabel(stageLeg.segments.at(-1)!.destination)}`:'No flights matched this search'}</h2></div><div className="flight-results-count"><strong>{fareGroups.length} {fareGroups.length===1?'flight':'flights'}</strong><small>{offers.length} {offers.length===1?'fare':'fares'} · {adults+children+infants} {adults+children+infants===1?'traveler':'travelers'}</small></div></div>
      {result.offers.length > 0 && <div className="flight-sort-toolbar"><button className="flight-mobile-filter-toggle account-outline-button" type="button" aria-expanded={filtersOpen} aria-controls="flight-filters" onClick={()=>{setOpenDetails(null);setComparisonOpen(false);setFiltersOpen(value=>!value);}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 7h16M4 17h16M9 4v6M15 14v6"/></svg>Filters{activeFilters.length ? ` · ${activeFilters.length}` : ''}</button><div className="flight-sort-tabs" role="group" aria-label="Sort results">{([['RECOMMENDED','Recommended'],['DIRECT_FIRST','Direct first'],['CHEAPEST','Cheapest'],['FASTEST','Fastest']] as const).map(([value,label]) => { const eligible = value==='DIRECT_FIRST'?offers.filter(offer=>legOf(offer,currentLegIndex)!.stops===0):offers;const lowest = eligible.length?Math.min(...eligible.map(offer=>Number(offer.totalAmount))):null; return <button type="button" key={value} className={sort === value ? 'active' : ''} aria-pressed={sort === value} onClick={() => setSort(value)}><strong>{label}</strong><small>{lowest!==null&&(value==='CHEAPEST'||value==='DIRECT_FIRST')?`From ${money(String(lowest), stageOffers[0]?.currency ?? currency)}`:value==='FASTEST'?'Shortest duration':value==='DIRECT_FIRST'?'Fewest stops':'Airline results'}</small></button>; })}</div><label className="flight-sort-select">Sort by<select aria-label="Sort flights" value={sort} onChange={event=>setSort(event.target.value as Sort)}><option value="RECOMMENDED">Recommended</option><option value="CHEAPEST">Lowest price</option><option value="DIRECT_FIRST">Fewest stops</option><option value="FASTEST">Shortest duration</option><option value="EARLIEST">Earliest departure</option></select></label></div>}
      {stableGroups.rankingChanged && <div className="flight-order-notice" role="status"><span>New fares are available. Your current flight order has been kept.</span><button type="button" onClick={() => setOrderRevision(value => value + 1)}>Update order</button></div>}
      {restoredResults && <div className="flight-order-notice"><span>Previous results restored.</span><button type="button" disabled={loading} onClick={() => { restoringSearch.current = true; searchForm.current?.requestSubmit(); }}>Refresh prices</button></div>}
      {filtersActive&&<div className="flight-active-filters" aria-label="Active filters">{activeFilters.map((filter, index) => <button key={`${filter.label}-${index}`} type="button" onClick={filter.clear} aria-label={`Remove filter: ${filter.label}`}>{filter.label} <span aria-hidden="true">×</span></button>)}<button type="button" onClick={resetStageFilters}>Clear all filters</button></div>}
      {result.offers.length === 0 ? <div className="account-panel flight-empty"><h3>No flights found for these dates</h3><p>Try another date or change your departure or arrival airport.</p><button type="button" className="account-outline-button" onClick={editSearch}>Edit search</button></div> : fareGroups.length === 0 ? <div className="account-panel flight-empty"><h3>{stageOffers.length ? 'No flights match your filters' : 'Your selected connection is no longer available'}</h3><p>{stageOffers.length ? activeFilters.map(filter => filter.label).join(' · ') : 'Choose your flights again from the available itineraries.'}</p>{stageOffers.length ? <button type="button" className="btn-primary" onClick={resetStageFilters}>Clear {activeFilters.length} {activeFilters.length === 1 ? 'filter' : 'filters'}</button> : <button type="button" className="btn-primary" onClick={() => { setSelectedLegKeys([]); setSelectedFareKeys([]); resetStageFilters(); }}>Choose flights again</button>}<button type="button" className="account-outline-button" onClick={editSearch}>Edit search</button></div> : <div className="flight-offer-list">{stableGroups.groups.slice(0, visibleCount).map((group) => {
        const active = group.fares.find((fare) => fare.offerId === fareChoice[group.key]) ?? group.fares[0]!;
        return <FlightOfferCard key={group.key} groupKey={group.key} fares={group.fares} active={active} detailsOpen={openDetails === group.key} legIndex={currentLegIndex} finalLeg={currentLegIndex === totalLegs - 1} tripType={tripType} passengerLabel={passengerLabel}
          airports={stopAirports} onFare={updateFare} onDetails={showDetails} onCloseDetails={closeDetails} onChooseLeg={selectLeg} onChoose={selectFare}
          compared={comparedIds.includes(group.fares[0]!.offerId)} compareFull={comparedIds.length >= 3} comparedIds={openDetails === group.key ? comparedIds : emptyComparisonIds} onCompare={toggleComparison}/>;
      })}</div>}
      {fareGroups.length > visibleCount && <button type="button" className="account-outline-button flight-show-more" onClick={() => setVisibleCount((count) => count + 30)}>Show more flights</button>}
      {loading && !filtersActive && <div className="flight-more-results-loading" aria-hidden="true"><FlightRowSkeleton/></div>}
      <p className="flight-fare-note">Prices found {new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(result.searchedAt))}. Fares and availability may change until confirmed.</p>
      </div></div>
    </section>}
    {comparedOffers.length > 0 && <div className="flight-compare-tray" aria-label="Selected fares for comparison"><div><strong>{comparedOffers.length} of 3 fares selected</strong><div>{comparedOffers.map(fare => <button type="button" key={fare.offerId} onClick={() => toggleComparison(fare.offerId)} aria-label={`Remove ${fare.airlineCodes.join('/')} ${money(fare.totalAmount, fare.currency)} from comparison`}>{fare.airlineCodes.join('/')} · {money(fare.totalAmount, fare.currency)} <span aria-hidden="true">×</span></button>)}</div></div><div><button type="button" className="account-outline-button" onClick={() => setComparedIds([])}>Clear</button><button type="button" className="btn-primary" disabled={comparedOffers.length < 2} onClick={() => { setOpenDetails(null); setFiltersOpen(false); setComparisonOpen(true); }}>Compare fares</button></div></div>}
    {comparisonOpen && <Suspense fallback={<FlightComparisonLoading onClose={() => setComparisonOpen(false)}/>}><FlightComparison offers={comparedOffers} passengerLabel={passengerLabel} finalLeg={currentLegIndex === totalLegs - 1} onClose={() => setComparisonOpen(false)} onChoose={currentLegIndex === totalLegs - 1 ? selectFare : selectLeg} onRemove={toggleComparison}/></Suspense>}
  </div>;
}

function FlightComparisonLoading({ onClose }: { onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  useFlightDialog(true, panel, onClose);
  return <div className="flight-fare-overlay"><section ref={panel} className="flight-comparison-dialog" role="dialog" aria-modal="true" aria-label="Loading fare comparison" tabIndex={-1}><header className="flight-fare-drawer-head"><h2>Compare fares</h2><button type="button" className="flight-fare-drawer-close" aria-label="Close fare comparison" onClick={onClose}>×</button></header><p className="flight-comparison-body" role="status">Preparing your fare comparison…</p></section></div>;
}

function TimeWindowFilter({ label, value, onChange }: { label: string; value: [number, number]; onChange: (value: [number, number]) => void }) {
  return <div className="flight-time-filter"><div className="flight-time-filter-label"><span>{label}</span><small>{clockLabel(value[0])}–{clockLabel(value[1])}</small></div>
    <div className="flight-double-range"><input type="range" min="0" max="1440" step="15" value={value[0]} aria-label={`Earliest ${label.toLowerCase()}`} onChange={(event) => onChange([Math.min(Number(event.target.value), value[1]), value[1]])} /><input type="range" min="0" max="1440" step="15" value={value[1]} aria-label={`Latest ${label.toLowerCase()}`} onChange={(event) => onChange([value[0], Math.max(Number(event.target.value), value[0])])} /></div>
    <div className="flight-time-range-labels"><span>00:00</span><span>24:00</span></div>
  </div>;
}

const FlightOfferCard = memo(function FlightOfferCard({ groupKey, fares, active, detailsOpen, legIndex, finalLeg, tripType, passengerLabel, airports, onFare, onDetails, onCloseDetails, onChooseLeg, onChoose, compared, compareFull, comparedIds, onCompare }: {
  groupKey: string; compared: boolean; compareFull: boolean; comparedIds: string[]; onCompare: (id: string) => void;
  fares: FlightOffer[]; active: FlightOffer; detailsOpen: boolean; legIndex: number; finalLeg: boolean; tripType: FlightTripType; passengerLabel: string;
  airports: Record<string, { city: string; name: string }>;
  onFare: (key: string, offer: FlightOffer) => void; onDetails: (key: string) => void; onCloseDetails: () => void; onChooseLeg: (offer: FlightOffer, preserveFare?: boolean) => void; onChoose: (offer: FlightOffer) => void;
}) {
  const leg = legOf(active, legIndex)!;
  const routeStart = leg.segments[0]?.origin ?? '';
  const routeEnd = leg.segments.at(-1)?.destination ?? '';
  const airlineCodes = [...new Set(leg.segments.flatMap((segment) => [segment.marketingCarrier, segment.operatingCarrier].filter((value): value is string => !!value)))];
  const segments = legsOf(fares[0]!).flatMap(leg=>leg.segments);
  const seats = segments.length && segments.every(segment=>Number.isInteger(segment.seatsAvailable))?Math.min(...segments.map(segment=>segment.seatsAvailable!)):null;
  const cabins = [...new Set(fares.map(fare=>fare.cabin).filter(Boolean))];
  return <>
    <article className="account-panel flight-offer flight-result-row" data-flight-group={groupKey}>
      <div className="flight-row-benefits">{hasIncludedCheckedBaggage(fares[0]!,legIndex)&&<span className="flight-row-baggage">Checked baggage included</span>}<span>{cabins.length>1?`${cabins.length} cabin options`:cabinLabel(fares[0]!.cabin)}</span>{seats!==null&&seats>0&&seats<=3&&<span className="flight-row-seats" title="Lowest reported seat availability across the trip at the displayed fare. Availability can change.">{seats} {seats===1?'seat':'seats'} at this fare</span>}</div>
      <div className="flight-row-main"><div className="flight-row-airline"><AirlineIdentity codes={[leg.segments[0]!.marketingCarrier]} /><small>{leg.segments.map(segment=>`${segment.marketingCarrier} ${segment.flightNumber}`).join(' · ')}</small>{airlineCodes.some(code=>code!==leg.segments[0]!.marketingCarrier)&&<small>{leg.segments.some(segment=>segment.operatingCarrier&&segment.operatingCarrier!==segment.marketingCarrier)?'Includes a codeshare flight':'Multiple airlines'}</small>}</div>
        <CompactFlightTimeline leg={leg} airports={airports}/>
        <div className="flight-row-purchase"><small>{tripType==='ONE_WAY'?'One-way':'Complete trip'} from</small><strong>{money(fares[0]!.totalAmount,fares[0]!.currency)}</strong><small>Total for {passengerLabel}</small><button type="button" className="btn-primary" aria-expanded={detailsOpen} onClick={() => onDetails(groupKey)}>{finalLeg?'Select fare':'Select flight'} <span aria-hidden="true">›</span></button></div>
      </div>
      <div className="flight-row-footer"><button type="button" onClick={() => onDetails(groupKey)} aria-expanded={detailsOpen}>Details &amp; {fares.length} {fares.length === 1 ? 'fare' : 'fares'} <span aria-hidden="true">⌄</span></button><label className="flight-compare-check" title="Compare the lowest fare for this flight"><input type="checkbox" checked={compared} disabled={!compared && compareFull} onChange={() => onCompare(fares[0]!.offerId)}/><span><span className="flight-compare-desktop-label">Compare from fare</span><span className="flight-compare-mobile-label" aria-hidden="true">Compare</span><span className="sr-only"> {money(fares[0]!.totalAmount, fares[0]!.currency)} for {routeStart} to {routeEnd}</span></span></label></div>
    </article>
    {detailsOpen && <FareDetailsDrawer fares={fares} active={active} route={`${routeStart} → ${routeEnd}`} legIndex={legIndex} finalLeg={finalLeg} tripType={tripType} passengerLabel={passengerLabel} airports={airports} onFare={offer => onFare(groupKey, offer)} onChooseLeg={onChooseLeg} onChoose={onChoose} onClose={onCloseDetails} comparedIds={comparedIds} compareFull={compareFull} onCompare={onCompare}/>}
  </>;
}, (previous, next) => previous.fares.length === next.fares.length && previous.fares.every((fare, index) => fare === next.fares[index]) && (Object.keys(next) as (keyof typeof next)[]).filter(key => key !== 'fares').every(key => previous[key] === next[key]));

function CompactFlightTimeline({leg,airports}:{leg:FlightOffer['outbound'];airports:Record<string,{city:string;name:string}>}) {
  const first=leg.segments[0],last=leg.segments.at(-1);
  if(!first||!last)return null;
  const dayChange=Math.round((Date.parse(last.arrivalAt.slice(0,10))-Date.parse(first.departureAt.slice(0,10)))/86400000);
  const stops=leg.stops;
  const connectionCities=[...new Set(leg.segments.slice(0,-1).map(segment=>airports[segment.destination]?.city??segment.destination))];
  const time=(value:string)=>/T(\d{2}:\d{2})/.exec(value)?.[1]??'—';
  return <div className="flight-row-timeline"><div className="flight-row-endpoint"><strong title={dateTime(first.departureAt)}>{time(first.departureAt)}</strong><span>{first.origin}</span><small>{airports[first.origin]?.city}</small></div>
    <div className="flight-row-path"><span>{minutes(leg.durationMinutes)||'Duration unavailable'}</span><i aria-hidden="true">{leg.segments.slice(0,-1).map((_,index)=><b key={index} style={{left:`${(index+1)/leg.segments.length*100}%`}}/>)}</i><span>{stops===0?'Direct':`${stops} ${stops===1?'stop':'stops'}`}</span>{connectionCities.length>0&&<small title={connectionCities.join(' · ')}>{connectionCities.join(' · ')}</small>}</div>
    <div className="flight-row-endpoint"><strong title={dateTime(last.arrivalAt)}>{time(last.arrivalAt)}{dayChange!==0&&Number.isFinite(dayChange)&&<sup title={`Arrival date: ${last.arrivalAt.slice(0,10)}`}>{dayChange>0?'+':''}{dayChange}</sup>}</strong><span>{last.destination}</span><small>{airports[last.destination]?.city}</small></div>
  </div>;
}

function FareDetailsDrawer({ fares, active, route, legIndex, finalLeg, tripType, passengerLabel, airports, onFare, onChooseLeg, onChoose, onClose, comparedIds, compareFull, onCompare }: {
  comparedIds: string[]; compareFull: boolean; onCompare: (id: string) => void;
  fares: FlightOffer[]; active: FlightOffer; route: string; legIndex: number; finalLeg: boolean; tripType: FlightTripType; passengerLabel: string; airports: Record<string, { city: string; name: string }>;
  onFare: (offer: FlightOffer) => void; onChooseLeg: (offer: FlightOffer, preserveFare?: boolean) => void; onChoose: (offer: FlightOffer) => void; onClose: () => void;
}) {
  const drawer=useRef<HTMLElement>(null);
  useEffect(()=>{
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const panel=drawer.current;
    panel?.querySelector<HTMLButtonElement>('button')?.focus();
    const trap=(event:KeyboardEvent)=>{
      if(event.key!=='Tab'||!panel)return;
      const elements=[...panel.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex="0"]')].filter(element=>element.getClientRects().length>0);
      const first=elements[0],last=elements.at(-1);
      if(!first||!last){event.preventDefault();return;}
      if(event.shiftKey&&(document.activeElement===first||!panel.contains(document.activeElement))){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||!panel.contains(document.activeElement))){event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',trap);
    return()=>{document.removeEventListener('keydown',trap);if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[]);
  const legs = legsOf(active);
  // Intermediate stages show the lowest available complete itinerary per outbound fare.
  // Remaining return alternatives stay available when the customer chooses the next leg.
  const displayFares = useMemo(() => {
    if (finalLeg) return fares;
    const groups = new Map<string, FlightOffer[]>();
    for (const fare of fares) {
      const key = legFareKey(fare, legIndex);
      const group = groups.get(key);
      if (group) group.push(fare); else groups.set(key, [fare]);
    }
    return [...groups.values()].map(options => {
      const ordered = [...options].sort((a, b) => Number(a.totalAmount) - Number(b.totalAmount));
      return ordered.find(fare => !legsOf(fare).some(leg => leg.segments.some(segment => segment.seatsAvailable === 0))) ?? ordered[0]!;
    }).sort((a, b) => Number(a.totalAmount) - Number(b.totalAmount));
  }, [fares, finalLeg, legIndex]);
  const availableFares = displayFares.filter(fare => !legsOf(fare).some(leg => leg.segments.some(segment => segment.seatsAvailable === 0)));
  const lowestFareId = (availableFares.length ? availableFares : displayFares).reduce<FlightOffer | undefined>((lowest, fare) => !lowest || Number(fare.totalAmount) < Number(lowest.totalAmount) ? fare : lowest, undefined)?.offerId;
  return <div className="flight-fare-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={drawer} className="flight-fare-drawer" role="dialog" aria-modal="true" aria-label={`Fare details for ${route}`}>
      <header className="flight-fare-drawer-head"><div><p className="account-eyebrow">FLIGHT DETAILS & FARES</p><h2>{route}</h2></div><button type="button" className="flight-fare-drawer-close" aria-label="Close fare details" onClick={onClose}>×</button></header>
      <div className="flight-fare-drawer-body"><section className="flight-fare-itinerary" aria-label="Flight itinerary"><h3>{finalLeg ? 'Complete flight itinerary' : 'Flight details'}</h3>
        {(finalLeg ? legs : [legs[legIndex]!]).map((leg,index) => <FlightLegView key={`${leg.segments[0]?.origin}-${index}`} title={finalLeg ? (active.multiCityLegs ? `Flight ${index + 1}` : index === 0 ? 'Depart' : 'Return') : (tripType === 'MULTI_CITY' ? `Flight ${legIndex + 1}` : legIndex === 0 ? 'Outbound' : 'Return')} offer={leg} airports={airports} />)}
      </section>
      <section className="flight-fare-select"><div className="flight-fare-select-heading"><div><h3>Select fare</h3><p>{displayFares.length} fare option{displayFares.length === 1 ? '' : 's'} for your itinerary</p></div><span className="flight-fare-passenger-count">♙ {passengerLabel}</span></div>
        <div className="flight-fare-card-grid">{displayFares.map((fare) => {
          const flexibility = (['REFUND', 'CHANGE'] as const).flatMap(type => penaltySummary(fare, type));
          const fareSegments = legsOf(fare).flatMap(leg => leg.segments);
          const bookingClasses = [...new Set(fareSegments.map(segment => segment.bookingClass).filter(Boolean))];
          const availableSeats = fareSegments.length && fareSegments.every(segment => Number.isInteger(segment.seatsAvailable))
            ? Math.min(...fareSegments.map(segment => segment.seatsAvailable!)) : null;
          const unavailable = fareSegments.some(segment => segment.seatsAvailable === 0);
          const isLowestFare = fare.offerId === lowestFareId;
          const itineraryLabel = tripType === 'ROUND_TRIP' ? 'Round trip' : tripType === 'MULTI_CITY' ? 'Multi-city' : 'One way';
          return <article className="flight-fare-detail-card" key={fare.offerId}>
            {isLowestFare && <span className="flight-fare-recommendation">Lowest price</span>}
            <div className="flight-fare-card-price"><div><strong>{money(fare.totalAmount, fare.currency)}</strong><span className="flight-fare-info" title={finalLeg ? "Total fare for all selected flights and passengers" : "Starting total for a complete itinerary; choose remaining flights to confirm"} aria-label={finalLeg ? "Total fare for all selected flights and passengers" : "Starting total for a complete itinerary; choose remaining flights to confirm"}>i</span></div><small>{itineraryLabel} · {finalLeg ? 'total fare' : 'starting total'}</small>{(unavailable || availableSeats !== null) && <span className={`flight-fare-seats${unavailable || availableSeats! <= 3 ? ' limited' : ''}`} title="Availability reported for this booking class at search time. For connecting or return flights, the lowest reported segment availability is shown.">{unavailable ? 'No seats available at this fare' : `${availableSeats! >= 9 ? '9+' : availableSeats} ${availableSeats === 1 ? 'seat' : 'seats'} available at this fare`}</span>}{fare.fareBrand && <span className="flight-fare-brand-chip">{fare.fareBrand}</span>}</div>
            {(fare.cabin || bookingClasses.length > 0) && <div className="flight-fare-card-name">{fare.cabin && <strong>{cabinLabel(fare.cabin)}</strong>}{bookingClasses.length > 0 && <small>Booking {bookingClasses.length === 1 ? 'class' : 'classes'} {bookingClasses.join(' / ')}</small>}</div>}
            {hasKnownBaggage(fare) && <section className="flight-fare-benefit-section"><h4>Baggage</h4><FlightBaggageDetails offer={fare} knownOnly /></section>}
            {flexibility.length > 0 && <section className="flight-fare-benefit-section"><h4>Flexibility</h4>{flexibility.map(summary => <p className="flight-fare-policy" key={summary}><span aria-hidden="true">{summary.includes('Non-refundable') || summary.includes('not permitted') ? '×' : '↻'}</span><strong>{summary}</strong></p>)}{(fare.penalties ?? []).some(rule => rule.type === 'CHANGE' && rule.allowed) && <p className="flight-fare-unspecified">Fare difference may apply.</p>}</section>}
            {hasKnownServices(fare) && <section className="flight-fare-benefit-section"><h4>Meals & services</h4><FlightServiceDetails offer={fare} knownOnly /></section>}
            <p className="flight-fare-passenger-note">Total for {passengerLabel}</p>
            <label className="flight-compare-check flight-fare-compare"><input type="checkbox" checked={comparedIds.includes(fare.offerId)} disabled={unavailable || (!comparedIds.includes(fare.offerId) && compareFull)} onChange={() => onCompare(fare.offerId)}/><span>{comparedIds.includes(fare.offerId) ? 'Added to comparison' : compareFull ? 'Choose up to 3 fares' : 'Add to comparison'}</span></label>
            <button type="button" className="btn-primary flight-fare-select-button" disabled={unavailable} onClick={() => { if (finalLeg) { onFare(fare); onChoose(fare); } else onChooseLeg(fare, true); }}>{unavailable ? 'Fare unavailable' : 'Select fare'}</button>
          </article>;
        })}</div>
      </section>{!finalLeg && <p className="flight-fare-disclaimer">These prices and benefits are for the lowest matching complete itinerary. Select a fare, then choose your remaining flights to confirm the total and conditions.</p>}<p className="flight-fare-disclaimer">Prices and availability are confirmed before reservation. Baggage and fare conditions apply to the flights shown.</p></div>
    </section>
  </div>;
}

function FlightLegView({ title, offer, airports, compact = false }: { title: string; offer: FlightOffer['outbound']; airports: Record<string, { city: string; name: string }>; compact?: boolean }) {
  const first = offer.segments[0], last = offer.segments.at(-1);
  if (!first || !last) return null;
  const stopCount = Math.max(0, Math.min(offer.stops, offer.segments.length - 1));
  const airportLabel = (code: string) => airports[code]?.city ? `${airports[code].city} (${code})` : code;
  return <div className="flight-leg"><span className="flight-leg-label">{title}</span><div className="flight-leg-route"><div><strong>{first.origin}</strong><small>{dateTime(first.departureAt)}</small></div><div className="flight-leg-line"><span>{minutes(offer.durationMinutes)}</span><i aria-hidden="true">{Array.from({ length: stopCount }, (_, index) => <span className="flight-stop-dot" key={index} style={{ left: `${((index + 1) / (stopCount + 1)) * 100}%` }} />)}</i><span>{stopCount === 0 ? 'Direct' : `${stopCount} ${stopCount === 1 ? 'stop' : 'stops'}`}</span></div><div><strong>{last.destination}</strong><small>{dateTime(last.arrivalAt)}</small></div></div>
    {!compact && <div className="flight-segment-info">{offer.segments.map((segment) => <div key={`${segment.marketingCarrier}-${segment.flightNumber}-${segment.departureAt}`}><span>{airlineName(segment.marketingCarrier) ?? segment.marketingCarrier} ({segment.marketingCarrier}) {segment.flightNumber}</span>{segment.operatingCarrier && segment.operatingCarrier !== segment.marketingCarrier && <span>Operated by {airlineName(segment.operatingCarrier) ?? segment.operatingCarrier} ({segment.operatingCarrier})</span>}{segment.aircraftTypeCode && <small>Aircraft {segment.aircraftTypeCode}</small>}<small>{airportLabel(segment.origin)} → {airportLabel(segment.destination)}</small></div>)}</div>}
    {!compact && offer.segments.length > 1 && <div className="flight-connections">{offer.segments.slice(0, -1).map((arriving, index) => {
      const onward = offer.segments[index + 1]!;
      const arrival = Date.parse(arriving.arrivalAt), departure = Date.parse(onward.departureAt);
      const waitMinutes = Number.isFinite(arrival) && Number.isFinite(departure) && departure >= arrival ? Math.floor((departure - arrival) / 60_000) : null;
      const airportChange = arriving.destination !== onward.origin;
      const airport = airports[onward.origin];
      return <div className="flight-connection" key={`${index}-${arriving.destination}-${onward.origin}`}>
        <div className="flight-connection-place"><strong>{airportChange ? `Airport change: ${airportLabel(arriving.destination)} → ${airportLabel(onward.origin)}` : `Layover in ${airportLabel(onward.origin)}`}</strong>{airport?.name && <span>{airport.name}</span>}</div>
        <div className="flight-connection-detail"><span>{airportChange ? 'Connection time' : 'Layover'}{waitMinutes === null ? ' unavailable' : ` ${minutes(waitMinutes)}`}</span><span>Next: {airlineName(onward.marketingCarrier) ?? 'Airline'} ({onward.marketingCarrier}) {onward.flightNumber}{onward.operatingCarrier && onward.operatingCarrier !== onward.marketingCarrier ? ` · Operated by ${airlineName(onward.operatingCarrier) ?? 'airline'} (${onward.operatingCarrier})` : ''}</span></div>
      </div>;
    })}</div>}
    </div>;
}
