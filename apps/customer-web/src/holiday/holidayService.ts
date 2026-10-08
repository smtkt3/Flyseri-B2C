import type { HolidayBooking, HolidayBookingInput, HolidayPackage } from '@flyseri/types';
import { apiClient } from '../lib/api/client';
export const holidayService = {
  async list(signal?: AbortSignal) { return (await apiClient.get<HolidayPackage[]>('/holidays', { anonymous: true, signal })).data; },
  async detail(id: string, signal?: AbortSignal) { return (await apiClient.get<HolidayPackage>(`/holidays/${encodeURIComponent(id)}`, { anonymous: true, signal })).data; },
  async book(input: HolidayBookingInput) { return (await apiClient.post<HolidayBooking>('/holidays/bookings', input)).data; },
  async bookings() { return (await apiClient.get<HolidayBooking[]>('/holidays/bookings')).data; },
};
export const holidayMoney = (value: number) => `BDT ${new Intl.NumberFormat('en-BD', { maximumFractionDigits: 2 }).format(value)}`;
