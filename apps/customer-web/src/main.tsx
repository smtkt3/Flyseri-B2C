import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import './account/account.css'
import './trip/trip.css'
import './document/document.css'
import './flight/flight.css'
import './premium-theme.css'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { AuthRoutes } from './auth/AuthRoutes'
import { LanguageProvider } from './travel/language'
import { NetworkStatus } from './components/NetworkStatus'
import { AccountPreferencesSync } from './account/AccountPreferencesSync'
import './components/frontend-refinements.css'
import './travel/travel-tools.css'
import './compact-mobile.css'
import './tablet-responsive.css'
import './flight/flight-search-visibility.css'
import './components/checkout-action-bar.css'
import './app-density.css'
import './mobile-standard.css'
import './flight/flight-compact-header.css'
import './flight/flight-results-toolbar.css'
import './flight/flight-fare-compact.css'
import './flight/flight-result-polish.css'
import './flight/flight-results-usability.css'
import './flight/flight-help-preferences.css'
import { FixedActionInsets } from './components/FixedActionInsets'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <LanguageProvider><AuthProvider>
        <AccountPreferencesSync />
        <NetworkStatus />
        <FixedActionInsets />
        <AuthRoutes />
      </AuthProvider></LanguageProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
