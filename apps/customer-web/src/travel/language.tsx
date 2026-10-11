import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Language = 'en' | 'bn';
const bn: Record<string, string> = {
  'Customize your flight': 'আপনার ফ্লাইট সাজান', 'Your trip total': 'ভ্রমণের মোট খরচ', 'Continue to review': 'পর্যালোচনায় এগিয়ে যান', 'Skip extras': 'অতিরিক্ত সেবা বাদ দিন', 'Back': 'পেছনে',
  'Plan by budget': 'বাজেট অনুযায়ী ভ্রমণ', 'Plan your spending': 'খরচের পরিকল্পনা করুন',
  'Flights': 'ফ্লাইট', 'Flight': 'ফ্লাইট', 'Map Search': 'ম্যাপে খুঁজুন', 'AI Search': 'এআই সার্চ',
  'Your Journey Starts with Flyseri': 'আপনার যাত্রা শুরু হোক Flyseri-এর সাথে', 'Your next journey, made smarter.': 'আপনার পরবর্তী যাত্রা হোক আরও সহজ।',
  'Where would you like to go?': 'কোথায় যেতে চান?', 'Where to next?': 'এবার কোথায় যাবেন?', 'Find flights. Shape your next escape.': 'ফ্লাইট খুঁজুন। পরবর্তী ভ্রমণের পরিকল্পনা করুন।',
  'One-way': 'একমুখী', 'Return': 'ফিরতি', 'Multi-city': 'একাধিক শহর', 'From': 'কোথা থেকে', 'To': 'কোথায়',
  'Departure': 'যাত্রার তারিখ', 'Return date': 'ফেরার তারিখ', 'Choose date': 'তারিখ বাছুন', 'Search flights': 'ফ্লাইট খুঁজুন',
  'Economy': 'ইকোনমি', 'Business': 'বিজনেস', 'First': 'ফার্স্ট', 'Premium economy': 'প্রিমিয়াম ইকোনমি',
  'Sign in': 'সাইন ইন', 'Sign out': 'সাইন আউট', 'Sign in/register': 'সাইন ইন / নিবন্ধন', 'My Flyseri': 'আমার Flyseri',
  'Customer support': 'গ্রাহক সহায়তা', 'Find bookings': 'বুকিং খুঁজুন', 'Chat with us': 'আমাদের সাথে কথা বলুন', 'AI & travel support': 'এআই ও ভ্রমণ সহায়তা',
  'My Trips': 'আমার ভ্রমণ', 'My Orders': 'আমার অর্ডার', 'My Bookings': 'আমার বুকিং', 'My Documents': 'আমার নথি', 'Travellers': 'যাত্রী',
  'Payments': 'পেমেন্ট', 'Ask Seri': 'Seri-কে জিজ্ঞাসা করুন', 'Support': 'সহায়তা', 'Profile': 'প্রোফাইল', 'Home': 'হোম',
  'Plan your journey with Seri': 'Seri-এর সাথে ভ্রমণের পরিকল্পনা করুন', 'Your AI travel assistant': 'আপনার এআই ভ্রমণ সহকারী',
  'Need help from our team?': 'আমাদের দলের সহায়তা চান?', 'Contact team': 'দলের সাথে যোগাযোগ', 'Find a flight': 'ফ্লাইট খুঁজুন',
  'Plan a holiday': 'ছুটির পরিকল্পনা', 'Inspire me': 'ভ্রমণের আইডিয়া', 'Sign in for your saved trips': 'সংরক্ষিত ভ্রমণ দেখতে সাইন ইন করুন',
  'Holiday tour packages': 'হলিডে ট্যুর প্যাকেজ', 'Domestic': 'দেশীয়', 'International': 'আন্তর্জাতিক', 'Our partners': 'আমাদের সহযোগী',
  'Exclusive Airline Offers': 'বিশেষ এয়ারলাইন অফার', 'Sample offers · not bookable': 'নমুনা অফার · বুকিং করা যাবে না',
  'View flights': 'ফ্লাইট দেখুন', 'Check fares': 'ভাড়া দেখুন', 'Select flight': 'ফ্লাইট বাছুন', 'Refresh fares': 'ভাড়া আপডেট করুন',
  'Cheapest': 'সর্বনিম্ন দাম', 'Fastest': 'দ্রুততম', 'Best balance': 'দাম ও সময়ের ভারসাম্য', 'Recommended': 'প্রস্তাবিত',
  'Lowest price': 'সর্বনিম্ন দাম', 'Shortest journey': 'সবচেয়ে কম সময়', 'Nonstop': 'সরাসরি', 'Sort': 'সাজান', 'Cabin': 'কেবিন',
  'Flight & fare details': 'ফ্লাইট ও ভাড়ার বিস্তারিত', 'Filters': 'ফিল্টার', 'Compare fares': 'ভাড়া তুলনা করুন', 'Clear': 'মুছুন',
  'Price alerts': 'দামের অ্যালার্ট', 'Watch this route': 'এই রুটের দাম নজরে রাখুন', 'Target total': 'কাঙ্ক্ষিত মোট দাম', 'Save price watch': 'দামের নজরদারি সংরক্ষণ',
  'Saved price watches': 'সংরক্ষিত দামের নজরদারি', 'Refresh': 'আপডেট', 'Remove': 'সরান', 'Search again': 'আবার খুঁজুন',
  'Trip budget': 'ভ্রমণের বাজেট', 'Total budget': 'মোট বাজেট', 'Adults': 'প্রাপ্তবয়স্ক', 'Children': 'শিশু', 'Nights': 'রাত',
  'Flights total': 'ফ্লাইটের মোট দাম', 'Stay per night': 'প্রতি রাতের আবাসন', 'Daily spending per person': 'প্রতিজনের দৈনিক খরচ', 'Other costs': 'অন্যান্য খরচ',
  'Estimated total': 'আনুমানিক মোট খরচ', 'Remaining budget': 'বাজেট বাকি', 'Over budget': 'বাজেটের বেশি', 'Explore packages': 'প্যাকেজ দেখুন',
  'Talk to our team': 'আমাদের দলের সাথে কথা বলুন', 'Review handover': 'সহায়তার অনুরোধ দেখুন', 'Share and request support': 'শেয়ার করে সহায়তা চান',
  'Not now': 'এখন নয়', 'Track your requests': 'অনুরোধের অগ্রগতি দেখুন', 'Support requests': 'সহায়তার অনুরোধ', 'Approve quoted fee': 'উল্লিখিত ফি অনুমোদন',
  'Queued': 'অপেক্ষমাণ', 'Reviewing': 'পর্যালোচনা চলছে', 'Quote ready': 'ফি প্রস্তুত', 'Approved': 'অনুমোদিত', 'In progress': 'কাজ চলছে', 'Completed': 'সম্পন্ন', 'Cancelled': 'বাতিল',
  'Booking progress': 'বুকিংয়ের অগ্রগতি', 'Reservation': 'রিজার্ভেশন', 'Payment received': 'পেমেন্ট গৃহীত', 'Ticket issued': 'টিকিট ইস্যু হয়েছে',
  'Travel companion': 'ভ্রমণ সঙ্গী', 'Save offline summary': 'অফলাইন সারাংশ সংরক্ষণ', 'Add flights to calendar': 'ক্যালেন্ডারে ফ্লাইট যোগ করুন',
  'My trips': 'আমার ভ্রমণ', 'Edit trip': 'ভ্রমণ সম্পাদনা', 'Your itinerary': 'আপনার ভ্রমণসূচি', 'Request assistance': 'সহায়তা চান',
  'Details': 'বিস্তারিত', 'What do you need?': 'কী সহায়তা চান?', 'Review request': 'অনুরোধ পর্যালোচনা', 'Confirm support request': 'সহায়তার অনুরোধ নিশ্চিত করুন',
  'Cancel request': 'অনুরোধ বাতিল', 'View support conversation →': 'সহায়তার কথোপকথন দেখুন →', 'Orders and payments': 'অর্ডার ও পেমেন্ট',
  'Retry': 'আবার চেষ্টা', 'Try again': 'আবার চেষ্টা', 'Continue': 'এগিয়ে যান', 'Cancel': 'বাতিল', 'Save': 'সংরক্ষণ', 'Send': 'পাঠান',
};
export const translate = (text: string, language: Language) => language === 'bn' ? bn[text] ?? text : text;
export function preferredLanguage(): Language { try { return localStorage.getItem('flyseri.language') === 'bn' ? 'bn' : 'en'; } catch { return 'en'; } }
const Context = createContext({ language: 'en' as Language, setLanguage: (_language: Language) => {}, t: (text: string) => text });
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, update] = useState(preferredLanguage);
  function setLanguage(value: Language) { update(value); try { localStorage.setItem('flyseri.language', value); } catch {} }
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  useEffect(() => { const sync = () => update(preferredLanguage()); window.addEventListener('storage', sync); return () => window.removeEventListener('storage', sync); }, []);
  return <Context.Provider value={{ language, setLanguage, t: text => translate(text, language) }}>{children}</Context.Provider>;
}
export const useLanguage = () => useContext(Context);
export function Translated({ text }: { text: string }) { return <>{useLanguage().t(text)}</>; }
