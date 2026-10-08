export interface HolidayPackage {
  id: string;
  title: string;
  category: 'DOMESTIC' | 'INTERNATIONAL';
  location: string;
  countryCode: string;
  imageUrl: string;
  summary: string;
  days: number;
  nights: number;
  adultPrice: number;
  childPrice: number;
  currency: 'BDT';
  maxPax: number;
  departureDates: string[];
  inclusions: string[];
  exclusions: string[];
  itinerary: string[];
  cancellationPolicy: string;
  published: boolean;
  version: number;
  preview?: boolean;
}
export interface HolidayBookingInput {
  packageId: string;
  packageVersion: number;
  departureDate: string;
  adults: number;
  children: number;
  contactName: string;
  email: string;
  phone: string;
  idempotencyKey: string;
}
export interface HolidayBooking {
  id: string;
  reference: string;
  packageTitle: string;
  departureDate: string;
  adults: number;
  children: number;
  totalAmount: number;
  currency: 'BDT';
  status: 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'CANCELLED';
  createdAt: string;
}
