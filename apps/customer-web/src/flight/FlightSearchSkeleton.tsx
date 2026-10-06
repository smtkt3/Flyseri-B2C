function Shape({className=''}:{className?:string}) {
  return <span className={`flight-skeleton-shape ${className}`} />;
}

/** Reuse the result row grid so the loading state has the same proportions. */
export function FlightRowSkeleton() {
  return <article className="account-panel flight-result-row flight-skeleton-row" aria-hidden="true">
    <div className="flight-row-benefits"><Shape className="skeleton-badge"/><Shape className="skeleton-badge short"/></div>
    <div className="flight-row-main">
      <div className="flight-row-airline"><div className="flight-skeleton-airline"><Shape className="skeleton-logo"/><div><Shape className="skeleton-name"/><Shape className="skeleton-caption"/></div></div><Shape className="skeleton-caption"/></div>
      <div className="flight-row-timeline">
        <div className="flight-row-endpoint"><Shape className="skeleton-time"/><Shape className="skeleton-airport"/><Shape className="skeleton-caption"/></div>
        <div className="flight-row-path"><Shape className="skeleton-duration"/><Shape className="skeleton-path"/><Shape className="skeleton-duration"/></div>
        <div className="flight-row-endpoint"><Shape className="skeleton-time"/><Shape className="skeleton-airport"/><Shape className="skeleton-caption"/></div>
      </div>
      <div className="flight-row-purchase"><Shape className="skeleton-caption"/><Shape className="skeleton-price"/><Shape className="skeleton-caption"/><Shape className="skeleton-button"/></div>
    </div>
    <div className="flight-row-footer"><Shape className="skeleton-footer"/><Shape className="skeleton-caption"/></div>
  </article>;
}

export function FlightSearchSkeleton() {
  return <section className="flight-results flight-search-skeleton" aria-label="Loading flight results" aria-busy="true">
    <p className="flight-skeleton-status" role="status">Checking flights for your route…</p>
    <div className="flight-mobile-skeleton" aria-hidden="true"><Shape className="skeleton-button"/></div>
    <div className="flight-results-layout">
      <aside className="account-panel flight-filter-sidebar flight-skeleton-filters" aria-hidden="true">
        <div className="flight-filter-heading"><Shape className="skeleton-heading"/><Shape className="skeleton-caption"/></div>
        {['quick','airlines','times'].map((section,index)=><div className="flight-filter-section" key={section}>
          <Shape className="skeleton-heading"/>{index===1&&<Shape className="skeleton-input"/>}
          {Array.from({length:index===1?5:2},(_,row)=><div className="flight-skeleton-filter-item" key={row}><Shape className="skeleton-checkbox"/><div><Shape className="skeleton-name"/>{index===1&&<Shape className="skeleton-caption"/>}</div>{index===1&&<Shape className="skeleton-filter-price"/>}</div>)}
        </div>)}
      </aside>
      <div className="flight-results-column">
        <div className="flight-results-head" aria-hidden="true"><div><Shape className="skeleton-caption"/><Shape className="skeleton-route"/></div><Shape className="skeleton-count"/></div>
        <div className="flight-sort-toolbar" aria-hidden="true"><div className="flight-sort-tabs">{Array.from({length:4},(_,index)=><div className="flight-skeleton-sort" key={index}><Shape className="skeleton-name"/><Shape className="skeleton-caption"/></div>)}</div><div className="flight-sort-select"><Shape className="skeleton-caption"/><Shape className="skeleton-name"/></div></div>
        <div className="flight-offer-list"><FlightRowSkeleton/><FlightRowSkeleton/><FlightRowSkeleton/></div>
      </div>
    </div>
  </section>;
}

export function TravellerSelectionSkeleton() {
  return <div className="flight-traveller-loading" aria-busy="true"><span className="sr-only" role="status">Loading your travelers…</span><div aria-hidden="true">{Array.from({length:3},(_,index)=><div className="flight-skeleton-filter-item" key={index}><Shape className="skeleton-checkbox"/><Shape className="skeleton-name"/></div>)}</div></div>;
}
