// @vitest-environment jsdom
import {afterEach,expect,it} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {ReviewFlightLeg,flightElapsedMinutes} from './ReviewFlightLeg';
afterEach(cleanup);
it('calculates elapsed time across offsets rather than subtracting local clocks',()=>{
 expect(flightElapsedMinutes('2026-10-18T08:25:00+06:00','2026-10-18T14:40:00+08:00')).toBe(255);
 expect(flightElapsedMinutes('2026-10-18T08:25:00','2026-10-18T14:40:00')).toBeNull();
});
it('shows local arrival date, elapsed duration and a connection across midnight',()=>{
 render(<ReviewFlightLeg title="Outbound" leg={{durationMinutes:null,stops:1,segments:[{origin:'DAC',destination:'SIN',departureAt:'2026-10-18T22:00:00+06:00',arrivalAt:'2026-10-19T04:00:00+08:00',marketingCarrier:'SQ',flightNumber:'447',durationMinutes:240},{origin:'SIN',destination:'KUL',departureAt:'2026-10-19T06:00:00+08:00',arrivalAt:'2026-10-19T07:00:00+08:00',marketingCarrier:'SQ',flightNumber:'102',durationMinutes:60}]}}/>);
 expect(screen.getByText('7h 0m')).toBeTruthy();
 expect(screen.getByText('Arrives on a different day')).toBeTruthy();
 expect(screen.getByText('Connection in SIN · 2h 0m')).toBeTruthy();
 expect(screen.getAllByText('Mon, Oct 19, 2026').length).toBeGreaterThan(0);
 expect(screen.getByText('via SIN')).toBeTruthy();
});
