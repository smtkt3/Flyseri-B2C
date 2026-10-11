// @vitest-environment jsdom
import {afterEach,expect,it} from 'vitest';
import {cleanup,render,screen,within} from '@testing-library/react';
import type {FlightOffer} from '@flyseri/types';
import {ReviewFlightInclusions} from './ReviewFlightInclusions';
afterEach(cleanup);
it('keeps each flight baggage and meal allowance with its supplier segment',()=>{
 const offer={outbound:{segments:[{origin:'DAC',destination:'SIN',marketingCarrier:'BG',flightNumber:'584'},{origin:'SIN',destination:'KUL',marketingCarrier:'SQ',flightNumber:'102'}]},baggageAllowances:[{type:'CHECKED',availability:'INCLUDED',description:'30 kg',segmentIndexes:[0]},{type:'CHECKED',availability:'INCLUDED',description:'20 kg',segmentIndexes:[1]}],amenities:[{category:'MEALS',name:'Halal meal',availability:'INCLUDED',segmentIndexes:[0]}]} as unknown as FlightOffer;
 render(<ReviewFlightInclusions offer={offer}/>);
 const outbound=screen.getByRole('region',{name:'Included services for DAC to SIN, BG 584'});
 const connection=screen.getByRole('region',{name:'Included services for SIN to KUL, SQ 102'});
 expect(within(outbound).getByText('Included · 30 kg')).toBeTruthy();
 expect(within(outbound).queryByText('Included · 20 kg')).toBeNull();
 expect(within(connection).getByText('Included · 20 kg')).toBeTruthy();
 expect(within(connection).getByText('Meal information not provided')).toBeTruthy();
 expect(within(outbound).getByText('Halal')).toBeTruthy();
});
