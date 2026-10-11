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
import './travel/travel-tools.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <LanguageProvider><AuthProvider>
        <AuthRoutes />
      </AuthProvider></LanguageProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
