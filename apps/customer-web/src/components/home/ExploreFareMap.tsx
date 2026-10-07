import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react"
import { Link } from "react-router-dom"
import type { PopularCachedFlightFare } from "@flyseri/types"
import { flightService } from "../../services/flightService"
import airports from "./map-airports.json"
import {
  WORLD_VIEW,
  layoutMapLabels,
  mercatorY,
  projectAirport,
  transformMap,
  worldSize,
  type MapPoint,
  type MapView,
} from "./fareMapGeometry"
import "./explore-fare-map.css"

const cityNames: Record<string, string> = {
  NRT: "Tokyo",
  DPS: "Bali",
  SYD: "Sydney",
  TPE: "Taipei",
  MNL: "Manila",
  CGP: "Chattogram",
  HAN: "Hanoi",
  PNH: "Phnom Penh",
  PVG: "Shanghai",
  CAN: "Guangzhou",
  CDG: "Paris",
  ATH: "Athens",
  HNL: "Honolulu",
  FRA: "Frankfurt",
  KUL: "Kuala Lumpur",
}
const photos: Record<string, string> = {
  LHR: "photo-1513635269975-59663e0ac1ad",
  ICN: "photo-1534274988757-a28bf1a57c17",
  NRT: "photo-1492571350019-22de08371fd3",
  DXB: "photo-1512453979798-5ea266f8880c",
  BKK: "photo-1563492065599-3520f775eeed",
  CGK: "photo-1555899434-94d1368aa7af",
  DPS: "photo-1537996194471-e657df975ab4",
  SYD: "photo-1506973035872-a4ec16b8e8d9",
  SIN: "photo-1525625293386-3f8f99389edd",
  CDG: "photo-1502602898657-3e91760cbb34",
  JFK: "photo-1519501025264-65ba15a82390",
  MLE: "photo-1514282401047-d79a71a590e8",
  ZRH: "photo-1506905925346-21bda4d32df4",
}
const countries = new Intl.DisplayNames(["en"], { type: "region" })
// Coordinates are extracted from the same airport directory used by flight search.
const places = airports
  .filter((place) => place.code !== "KUL")
  .map((place) => ({
    ...place,
    city: cityNames[place.code] ?? place.city,
    country: countries.of(place.country) ?? place.country,
    image: photos[place.code],
  }))
const originAirport = airports.find((place) => place.code === "KUL")!
const imageUrl = (id: string) =>
  `https://images.unsplash.com/${id}?w=200&q=80&fit=crop&auto=format`
const money = (fare?: PopularCachedFlightFare) =>
  fare
    ? `${fare.currency} ${Number(fare.price).toLocaleString("en-MY", { maximumFractionDigits: 0 })}`
    : "Check fares"
const flightUrl = (code: string, fare?: PopularCachedFlightFare) =>
  `/flights?${new URLSearchParams({ origin: "KUL", destination: code, tripType: "ONE_WAY", ...(fare ? { departureDate: fare.departureDate, currency: fare.currency, autoSearch: "1" } : {}) })}`

export function ExploreFareMap() {
  const mapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 1000, height: 520 })
  const [fares, setFares] = useState<PopularCachedFlightFare[]>([])
  const [active, setActive] = useState("BKK")
  const [view, setView] = useState<MapView>(WORLD_VIEW)
  const viewRef = useRef(view)
  const viewportRef = useRef({ width: 810, height: 472 })
  const pointers = useRef(new Map<number, MapPoint>())
  const dragStart = useRef<MapPoint | null>(null)
  const moved = useRef(false)
  const [dragging, setDragging] = useState(false)
  const [query, setQuery] = useState("")
  const commitView = (next: MapView) => {
    viewRef.current = next
    setView(next)
  }
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [faresOnly, setFaresOnly] = useState(false)
  const [routes, setRoutes] = useState(true)
  const [maxPrice, setMaxPrice] = useState(10000)
  const [listOpen, setListOpen] = useState(false)
  useEffect(() => {
    let mounted = true
    const refresh = () =>
      void flightService
        .popularCachedFares()
        .then((items) => {
          if (mounted)
            setFares(
              items.filter((item) =>
                places.some((place) => place.code === item.destination),
              ),
            )
        })
        .catch(() => {
          if (mounted) setFares([])
        })
    refresh()
    const timer = window.setInterval(refresh, 45000)
    return () => {
      mounted = false
      window.clearInterval(timer)
    }
  }, [])
  useEffect(() => {
    if (!mapRef.current || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        })
    })
    observer.observe(mapRef.current)
    return () => observer.disconnect()
  }, [])
  const mobile = size.width <= 760
  const plotWidth = mobile ? size.width : size.width - 190
  const plotHeight = mobile ? size.height - 154 : size.height - 48
  const viewport = { width: plotWidth, height: plotHeight }
  viewportRef.current = viewport
  const world = worldSize(view, viewport)
  const project = (lon: number, lat: number) =>
    projectAirport(lon, lat, view, viewport)
  const origin = project(originAirport.lon, originAirport.lat)
  const tileZoom = Math.min(7, Math.max(2, Math.ceil(Math.log2(world / 256))))
  const count = 2 ** tileZoom,
    tileSize = world / count
  const left = ((view.lon + 180) / 360) * world - plotWidth / 2,
    top = mercatorY(view.lat) * world - plotHeight / 2
  const tiles = []
  for (
    let y = Math.max(0, Math.floor(top / tileSize));
    y <= Math.min(count - 1, Math.floor((top + size.height) / tileSize));
    y++
  )
    for (
      let x = Math.floor(left / tileSize);
      x <= Math.floor((left + size.width) / tileSize);
      x++
    ) {
      tiles.push({
        x: ((x % count) + count) % count,
        y,
        left: x * tileSize - left,
        top: y * tileSize - top,
        key: `${tileZoom}-${x}-${y}`,
      })
    }
  const changeZoom = (factor: number, anchor?: MapPoint) => {
    const vp = viewportRef.current,
      point = anchor ?? { x: vp.width / 2, y: vp.height / 2 }
    commitView(transformMap(viewRef.current, vp, point, point, factor))
  }
  useEffect(() => {
    const element = mapRef.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      if (
        (event.target as Element).closest(
          "aside,article,.explore-map-list,.explore-map-zoom",
        )
      )
        return
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1)
      const point = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      }
      commitView(
        transformMap(
          viewRef.current,
          viewportRef.current,
          point,
          point,
          Math.exp(-Math.max(-160, Math.min(160, delta)) * 0.003),
        ),
      )
    }
    element.addEventListener("wheel", wheel, { passive: false })
    return () => element.removeEventListener("wheel", wheel)
  }, [])
  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (pointers.current.size === 0) moved.current = false

    if (
      event.button !== 0 ||
      (event.target as Element).closest(
        "aside,article,a,input,.explore-map-list,.explore-map-zoom,.explore-map-browse",
      )
    )
      return
    const rect = event.currentTarget.getBoundingClientRect()
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    pointers.current.set(event.pointerId, point)
    if (pointers.current.size === 1) {
      dragStart.current = point
      moved.current = false
    }
    if (pointers.current.size > 1)
      event.currentTarget.setPointerCapture?.(event.pointerId)
    if (!(event.target as Element).closest("button"))
      event.currentTarget.focus({ preventScroll: true })
  }
  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const previous = pointers.current.get(event.pointerId)
    if (!previous) return
    const rect = event.currentTarget.getBoundingClientRect()
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    const before = [...pointers.current.values()]
    pointers.current.set(event.pointerId, point)
    if (pointers.current.size > 1) {
      const after = [...pointers.current.values()]
      const midpoint = (points: MapPoint[]) => ({
        x: (points[0]!.x + points[1]!.x) / 2,
        y: (points[0]!.y + points[1]!.y) / 2,
      })
      const distance = (points: MapPoint[]) =>
        Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y)
      commitView(
        transformMap(
          viewRef.current,
          viewportRef.current,
          midpoint(before),
          midpoint(after),
          distance(after) / Math.max(1, distance(before)),
        ),
      )
      moved.current = true
      setDragging(true)
      return
    }
    if (
      !moved.current &&
      dragStart.current &&
      Math.hypot(point.x - dragStart.current.x, point.y - dragStart.current.y) <
        4
    )
      return
    const from = moved.current ? previous : (dragStart.current ?? previous)
    moved.current = true
    setDragging(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
    commitView(transformMap(viewRef.current, viewportRef.current, from, point))
  }
  function pointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
    if (!pointers.current.size) {
      setDragging(false)
      dragStart.current = null
    } else dragStart.current = [...pointers.current.values()][0]!
  }
  function mapKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return
    const offsets: Record<string, MapPoint> = {
      ArrowLeft: { x: 80, y: 0 },
      ArrowRight: { x: -80, y: 0 },
      ArrowUp: { x: 0, y: 80 },
      ArrowDown: { x: 0, y: -80 },
    }
    if (offsets[event.key]) {
      event.preventDefault()
      commitView(
        transformMap(
          viewRef.current,
          viewportRef.current,
          { x: 0, y: 0 },
          offsets[event.key]!,
        ),
      )
    } else if (["+", "=", "-", "Home"].includes(event.key)) {
      event.preventDefault()
      if (event.key === "Home") commitView(WORLD_VIEW)
      else changeZoom(event.key === "-" ? 1 / 1.5 : 1.5)
    }
  }
  const byCode = new Map(fares.map((fare) => [fare.destination, fare]))
  const visible = places.filter((place) => {
    const fare = byCode.get(place.code)
    return (
      (!faresOnly || !!fare) &&
      (!fare || maxPrice === 10000 || Number(fare.price) <= maxPrice)
    )
  })
  const selected =
    visible.find((place) => place.code === active) ?? visible[0] ?? places[4]!
  const selectedFare = byCode.get(selected.code)
  const onScreen = visible
    .map((place) => ({ ...place, point: project(place.lon, place.lat) }))
    .filter(
      (place) =>
        place.point.x >= 12 &&
        place.point.x <= plotWidth - 12 &&
        place.point.y >= 12 &&
        place.point.y <= plotHeight - 12,
    )
  const prioritized = [...onScreen].sort((a, b) => {
    const worldwide = ["NRT", "LHR", "JFK", "SYD", "DXB", "ICN", "CDG", "DPS", "MLE"]
    const rank = (code: string) => code === selected.code ? -2 : byCode.has(code) ? -1 : worldwide.includes(code) ? worldwide.indexOf(code) : photos[code] ? 20 : 30
    return rank(a.code) - rank(b.code)
  })
  const labels = layoutMapLabels(
    prioritized.map((place) => ({ code: place.code, point: place.point })),
    viewport,
    mobile,
    [
      { x: origin.x - 32, y: origin.y - 30, width: 64, height: 84 },
      ...(!mobile
        ? [{ x: 0, y: size.height - 165, width: 365, height: 165 }]
        : []),
      { x: 0, y: plotHeight * 0.48, width: 50, height: 110 },
    ],
  )
  const listed = visible.filter((place) =>
    `${place.city} ${place.country} ${place.code} ${place.name}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  )
  const choosePlace = (code: string, focus = false) => {
    setActive(code)
    setListOpen(false)
    if (focus) {
      const place = places.find((item) => item.code === code)!
      commitView({
        lon: place.lon,
        lat: place.lat,
        zoom: Math.max(4, viewRef.current.zoom),
      })
    }
  }
  const reset = () => {
    setMaxPrice(10000)
    setFaresOnly(false)
    setRoutes(true)
  }
  return (
    <section
      className="explore-map"
      aria-label="Explore flights on the world map"
    >
      <div className="explore-map-toolbar">
        <div>
          <span>From</span>
          <strong>
            KUL <small>Kuala Lumpur</small>
          </strong>
        </div>
        <i aria-hidden="true">→</i>
        <div>
          <span>To</span>
          <strong>
            Anywhere <small>Explore the world</small>
          </strong>
        </div>
        <button
          className="explore-map-desktop-browse"
          type="button"
          aria-expanded={listOpen}
          onClick={() => setListOpen(!listOpen)}
        >
          Explore destinations ⌕
        </button>
        <Link to="/flights" aria-label="Change flight route">
          ⇄
        </Link>
      </div>
      <div className="explore-map-tabs">
        <button
          type="button"
          aria-expanded={filtersOpen}
          onClick={() => {
            setFiltersOpen(!filtersOpen)
            setListOpen(false)
          }}
        >
          ☷ <span>Filters</span>
        </button>
        <Link to="/flights">
          ▦ <span>Choose dates</span>
        </Link>
        <button
          type="button"
          className={!listOpen ? "is-current" : ""}
          onClick={() => {
            setListOpen(false)
            setFiltersOpen(false)
          }}
        >
          ◎ <span>Map</span>
        </button>
        <button
          type="button"
          aria-expanded={listOpen}
          className={listOpen ? "is-current" : ""}
          onClick={() => {
            setListOpen(!listOpen)
            setFiltersOpen(false)
          }}
        >
          ◇ <span>Destinations</span>
        </button>
      </div>
      <div
        className={`explore-map-canvas${dragging ? " is-dragging" : ""}`}
        ref={mapRef}
        role="group"
        tabIndex={0}
        aria-describedby="explore-map-instructions"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerEnd}
        onPointerCancel={pointerEnd}
        onLostPointerCapture={pointerEnd}
        onKeyDown={mapKey}
        onClickCapture={(event) => {
          if (moved.current) {
            event.preventDefault()
            event.stopPropagation()
            moved.current = false
          }
        }}
        aria-label="Interactive world destination map"
      >
        <div className="explore-map-tiles" aria-hidden="true">
          {tiles.map((tile) => (
            <img
              draggable={false}
              key={tile.key}
              src={`https://tile.openstreetmap.org/${tileZoom}/${tile.x}/${tile.y}.png`}
              alt=""
              style={{
                left: tile.left,
                top: tile.top,
                width: tileSize + 0.5,
                height: tileSize + 0.5,
              }}
            />
          ))}
        </div>
        <div className="explore-map-wash" aria-hidden="true" />
        <div className="explore-map-gesture-plane" aria-hidden="true" />
        <svg
          className="explore-map-routes"
          viewBox={`0 0 ${size.width} ${size.height}`}
          aria-hidden="true"
        >
          {routes &&
            onScreen
              .filter(
                (place) =>
                  labels.some((label) => label.code === place.code) ||
                  place.code === selected.code ||
                  byCode.has(place.code),
              )
              .map((place) => {
                const point = place.point
                const wrappedOrigin = {
                  x:
                    origin.x + Math.round((point.x - origin.x) / world) * world,
                  y: origin.y,
                }
                return (
                  <g key={place.code}>
                    {[-1, 0, 1].map(copy => <path key={copy}
                      className={
                        selected.code === place.code ? "is-selected" : ""
                      }
                      d={`M ${wrappedOrigin.x + copy * world} ${wrappedOrigin.y} Q ${(wrappedOrigin.x + point.x) / 2 + copy * world} ${Math.min(wrappedOrigin.y, point.y) - Math.min(100, Math.abs(point.x - wrappedOrigin.x) * 0.22)} ${point.x + copy * world} ${point.y}`}
                    />)}
                  </g>
                )
              })}
          {labels.map((label) => (
            <path
              key={label.code}
              className="explore-map-leader"
              d={`M ${label.anchor.x} ${label.anchor.y} L ${Math.max(label.x, Math.min(label.x + label.width, label.anchor.x))} ${Math.max(label.y, Math.min(label.y + label.height, label.anchor.y))}`}
            />
          ))}
        </svg>
        {onScreen.map((place) => (
          <button
            key={place.code}
            className={`explore-map-dot${
              place.code === selected.code ? " is-selected" : ""
            }`}
            type="button"
            data-airport={place.code}
            data-latitude={place.lat}
            data-longitude={place.lon}
            style={{ left: place.point.x, top: place.point.y }}
            aria-label={`Select ${place.city} airport ${place.code}`}
            title={`${place.city} · ${place.code} · ${place.name}`}
            onClick={() => choosePlace(place.code)}
          />
        ))}
        {labels.map((label) => {
          const place = visible.find((item) => item.code === label.code)!
          return (
            <button
              key={place.code}
              type="button"
              className={`explore-map-place${
                selected.code === place.code ? " is-selected" : ""
              }`}
              style={{
                left: label.x,
                top: label.y,
                width: label.width,
                height: label.height,
              }}
              aria-pressed={selected.code === place.code}
              aria-label={`Select ${place.city}, ${money(byCode.get(place.code))}`}
              onClick={() => choosePlace(place.code)}
            >
              {place.image ? (
                <img draggable={false} src={imageUrl(place.image)} alt="" />
              ) : (
                <span className="explore-map-airport-icon" aria-hidden="true">
                  ✈
                </span>
              )}
              <span>
                <strong>{place.city}</strong>
                <small>
                  {byCode.has(place.code) ? "From " : ""}
                  {money(byCode.get(place.code))}
                </small>
              </span>
            </button>
          )
        })}
        <div
          className="explore-map-origin"
          style={{ left: origin.x, top: origin.y }}
        >
          <span className="explore-map-pin">
            <i />
          </span>
          <strong>
            KUL<small>Kuala Lumpur</small>
          </strong>
        </div>
        <div className="explore-map-zoom" aria-label="Map controls">
          <button
            type="button"
            aria-label="Zoom in map"
            disabled={view.zoom >= 32}
            onClick={() => changeZoom(1.5)}
          >
            +
          </button>
          <button
            type="button"
            aria-label="Zoom out map"
            disabled={view.zoom <= 1}
            onClick={() => changeZoom(1 / 1.5)}
          >
            −
          </button>
          <button
            type="button"
            aria-label="Show full world map"
            onClick={() => commitView(WORLD_VIEW)}
          >
            ◎
          </button>
          <button
            type="button"
            aria-label="Center map on Kuala Lumpur"
            onClick={() =>
              commitView({
                lon: originAirport.lon,
                lat: originAirport.lat,
                zoom: 4,
              })
            }
          >
            ⌖
          </button>
        </div>{" "}
        <aside
          className={`explore-map-filters${filtersOpen ? " is-open" : ""}`}
          aria-label="Map filters"
        >
          <div className="explore-map-filter-title">
            <strong>Find your next escape</strong>
            <button
              type="button"
              aria-label="Close map filters"
              onClick={() => setFiltersOpen(false)}
            >
              ×
            </button>
          </div>
          <label htmlFor="map-price">
            Max price{" "}
            <strong>
              {maxPrice === 10000
                ? "Any price"
                : `MYR ${maxPrice.toLocaleString()}`}
            </strong>
          </label>
          <input
            id="map-price"
            aria-label="Maximum cached fare"
            type="range"
            min="100"
            max="10000"
            step="100"
            value={maxPrice}
            onChange={(event) => setMaxPrice(Number(event.target.value))}
          />
          <p>Filter recently searched fares</p>
          <label className="explore-map-switch">
            Recent fares only
            <input
              type="checkbox"
              role="switch"
              checked={faresOnly}
              onChange={(event) => setFaresOnly(event.target.checked)}
            />
          </label>
          <label className="explore-map-switch">
            Show routes
            <input
              type="checkbox"
              role="switch"
              checked={routes}
              onChange={(event) => setRoutes(event.target.checked)}
            />
          </label>
          <div className="explore-map-filter-divider" />
          <small>Explore destinations worldwide</small>
          <button type="button" className="explore-map-clear" onClick={reset}>
            Clear all
          </button>
        </aside>
        {visible.length === 0 && (
          <p className="explore-map-no-results" role="status">
            No recent fares match these filters.{" "}
            <button type="button" onClick={reset}>
              Show all destinations
            </button>
          </p>
        )}
        {listOpen && (
          <div className="explore-map-list" aria-label="All map destinations">
            <header>
              <label>
                Find a destination
                <input
                  type="search"
                  aria-label="Search map destinations"
                  placeholder="City, country or airport code"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <button
                type="button"
                aria-label="Close destinations"
                onClick={() => setListOpen(false)}
              >
                ×
              </button>
            </header>
            {listed.map((place) => (
              <button
                type="button"
                key={place.code}
                onClick={() => choosePlace(place.code, true)}
              >
                <strong>
                  {place.city}{" "}
                  <small>
                    {place.code} · {place.country}
                  </small>
                </strong>
                <span>{money(byCode.get(place.code))} →</span>
              </button>
            ))}
            {listed.length === 0 && <p>No destinations match your search.</p>}
          </div>
        )}{" "}
        {visible.length > 0 && (
          <article
            className="explore-map-selection"
            aria-label="Selected destination"
          >
            {selected.image ? <img
              draggable={false}
              src={imageUrl(selected.image)}
              alt={`${selected.city} travel inspiration`}
            /> : <div className="explore-map-selection-icon" aria-hidden="true">✈<small>{selected.code}</small></div>}
            <div>
              <h3>
                {selected.city} <small>({selected.code})</small>
              </h3>
              <p>{selected.country}</p>
              <span title={selected.name}>
                {selectedFare
                  ? `Recent search · ${selectedFare.departureDate}`
                  : selected.name}
              </span>
            </div>
            <strong>{money(selectedFare)}</strong>
            <Link to={flightUrl(selected.code, selectedFare)}>
              View flights <span aria-hidden="true">→</span>
            </Link>
          </article>
        )}
        <a
          className="explore-map-attribution"
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          © OpenStreetMap contributors
        </a>
      </div>
      <p id="explore-map-instructions" className="explore-map-footnote">
        Drag to explore · Scroll or pinch to zoom · Arrow keys to move · Home
        for the world view. Explore destination ideas. Prices, when shown, are
        from recent searches; check live fares before booking.
      </p>
    </section>
  )
}
