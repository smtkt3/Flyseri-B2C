import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react"
import { Link } from "react-router-dom"
import { CalendarDateField } from "../CalendarDateField"
import { preferredCurrency, currencyPreferenceEvent } from "../LocaleMenu"
import type { PopularCachedFlightFare } from "@flyseri/types"
import { flightService } from "../../services/flightService"
import { useHomeSearchDraft, useHomeSearchField, homeSearchUrl } from "./homeSearchDraft"
import airports from "./map-airports.json"
import {
  WORLD_VIEW,
  clampMapView,
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
const allPlaces = airports
  .map((place) => ({
    ...place,
    city: cityNames[place.code] ?? place.city,
    country: countries.of(place.country) ?? place.country,
    image: photos[place.code],
  }))
const imageUrl = (id: string) =>
  `https://images.unsplash.com/${id}?w=200&q=80&fit=crop&auto=format`
const money = (fare?: PopularCachedFlightFare) =>
  fare
    ? `${fare.currency} ${Number(fare.price).toLocaleString("en-MY", { maximumFractionDigits: 0 })}`
    : "Check fares"
export function ExploreFareMap() {
  const search = useHomeSearchDraft()
  const [originCode, setOriginCode] = useHomeSearchField("origin")
  const originAirport = allPlaces.find((place) => place.code === originCode) ?? allPlaces.find(place => place.code === "DAC")!
  const places = useMemo(() => allPlaces.filter((place) => place.code !== originCode), [originCode])
  const [currency, setCurrency] = useState(preferredCurrency)
  const [selectingOrigin, setSelectingOrigin] = useState(false)
  const mapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 1000, height: 520 })
  const [fares, setFares] = useState<PopularCachedFlightFare[]>([])
  const [active, setActive] = useState("BKK")
  const [destinationValue, setDestinationValue] = useHomeSearchField("destination")
  const destination = destinationValue || null
  const setDestination = (code: string | null) => setDestinationValue(code ?? "")
  const [departureDate, setDepartureDate] = useHomeSearchField("departure")
  const localToday = new Date()
  const minimumDate = `${localToday.getFullYear()}-${String(localToday.getMonth() + 1).padStart(2, "0")}-${String(localToday.getDate()).padStart(2, "0")}`
  const [view, setView] = useState<MapView>({ lon: 94, lat: 23, zoom: 4 })
  const viewRef = useRef(view)
  const viewportRef = useRef({ width: 810, height: 472 })
  const pointers = useRef(new Map<number, MapPoint>())
  const dragStart = useRef<MapPoint | null>(null)
  const moved = useRef(false)
  const frame = useRef<number | null>(null)
  const gestureRect = useRef<DOMRect | null>(null)
  const [dragging, setDragging] = useState(false)
  const [query, setQuery] = useState("")
  const commitView = (next: MapView) => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
    viewRef.current = next
    setView(next)
  }
  // Pointer events can arrive faster than the display refreshes. Keep every
  // geographic delta, but render only the latest view once per animation frame.
  const queueView = (next: MapView) => {
    viewRef.current = next
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      setView(viewRef.current)
    })
  }
  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
  }, [])
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [faresOnly, setFaresOnly] = useState(false)
  const [routes, setRoutes] = useState(true)
  const [maxPrice, setMaxPrice] = useState<number | null>(null)
  const budgetLimit = currency === "BDT" ? 500000 : 10000
  const [listOpen, setListOpen] = useState(false)
  useEffect(() => {
    const update = () => { setCurrency(preferredCurrency()); setFares([]); setMaxPrice(null) }
    window.addEventListener(currencyPreferenceEvent, update)
    window.addEventListener("storage", update)
    return () => { window.removeEventListener(currencyPreferenceEvent, update); window.removeEventListener("storage", update) }
  }, [])
  useEffect(() => {
    let mounted = true
    const refresh = () =>
      void flightService
        .popularCachedFares(originCode, currency)
        .then((items) => {
          if (mounted)
            setFares(
              items.filter((item) =>
                item.currency === currency && (!departureDate || item.departureDate === departureDate) && places.some((place) => place.code === item.destination),
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
  }, [originCode, currency, departureDate, places])
  useEffect(() => {
    if (!mapRef.current || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        setSize((current) => current.width === entry.contentRect.width && current.height === entry.contentRect.height ? current : ({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        }))
    })
    observer.observe(mapRef.current)
    return () => observer.disconnect()
  }, [])
  const mobile = size.width <= 760
  const plotWidth = mobile ? size.width : size.width - 190
  const plotHeight = mobile ? size.height - 154 : size.height - 48
  const viewport = { width: plotWidth, height: plotHeight }
  viewportRef.current = viewport
  useEffect(() => {
    const current = viewRef.current
    const bounded = clampMapView(current, viewportRef.current)
    if (bounded !== current) commitView(bounded)
  }, [size.width, size.height])
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
      queueView(
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
    gestureRect.current = rect
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
    const rect = gestureRect.current
    if (!rect) return
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
      queueView(
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
    queueView(transformMap(viewRef.current, viewportRef.current, from, point))
  }
  function pointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
    if (!pointers.current.size) {
      commitView(viewRef.current)
      gestureRect.current = null
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
  const byCode = useMemo(() => new Map(fares.filter((fare) => fare.currency === currency && (!departureDate || fare.departureDate === departureDate)).map((fare) => [fare.destination, fare])), [fares, currency, departureDate])
  const visible = useMemo(() => places.filter((place) => {
    const fare = byCode.get(place.code)
    return (
      (!faresOnly || !!fare) &&
      (!fare || maxPrice === null || Number(fare.price) <= maxPrice)
    )
  }), [byCode, faresOnly, maxPrice])
  const selected =
    visible.find((place) => place.code === (destination || active)) ?? visible[0] ?? places[4]!
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
  const listed = (selectingOrigin ? allPlaces : visible).filter((place) =>
    `${place.city} ${place.country} ${place.code} ${place.name}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  )
  const choosePlace = (code: string, focus = false) => {
    setActive(code)
    setDestination(code)
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
    setMaxPrice(null)
    setFaresOnly(false)
    setRoutes(true)
  }
  return (
    <section
      className="explore-map"
      aria-label="Explore flights on the world map"
    >
      <div className="explore-map-toolbar">
        <button type="button" className="explore-map-destination-trigger" aria-label="Choose map departure airport" aria-expanded={listOpen && selectingOrigin} aria-controls="explore-map-destinations" onClick={() => { setSelectingOrigin(true); setQuery(""); setListOpen(!listOpen || !selectingOrigin); setFiltersOpen(false) }}>
          <span>From</span>
          <strong>
            {originAirport.code} <small>{originAirport.city} ⌄</small>
          </strong>
        </button>
        <i aria-hidden="true">→</i>
        <button
          className="explore-map-destination-trigger"
          type="button"
          aria-label="Choose map destination"
          aria-expanded={listOpen && !selectingOrigin}
          aria-controls="explore-map-destinations"
          onClick={() => { setSelectingOrigin(false); setQuery(""); setListOpen(!listOpen || selectingOrigin); setFiltersOpen(false) }}
        >
          <span>To</span>
          <strong>
            {destination ? places.find((place) => place.code === destination)?.city : "Anywhere"}
            <small>{destination ? `${destination} · Change destination ⌄` : "Explore the world ⌄"}</small>
          </strong>
        </button>
        <Link to={`/flights?${new URLSearchParams({ origin: originCode, currency })}`} aria-label="Change flight route">
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
        <CalendarDateField label="Choose dates" value={departureDate} minDate={minimumDate} onChange={setDepartureDate} className="explore-map-date" align="end" />
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
              decoding="async"
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
            {originAirport.code}<small>{originAirport.city}</small>
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
            aria-label={`Center map on ${originAirport.city}`}
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
              {maxPrice === null
                ? "Any price"
                : `${currency} ${maxPrice.toLocaleString()}`}
            </strong>
          </label>
          <input
            id="map-price"
            aria-label="Maximum cached fare"
            type="range"
            min="100"
            max={budgetLimit}
            step="100"
            value={maxPrice ?? budgetLimit}
            onChange={(event) => { const value = Number(event.target.value); setMaxPrice(value >= budgetLimit ? null : value) }}
          />

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
          <div id="explore-map-destinations" className="explore-map-list" aria-label={selectingOrigin ? "Map departure airports" : "All map destinations"}>
            <header>
              <label>
                {selectingOrigin ? "Choose departure airport" : "Find a destination"}
                <input
                  type="search"
                  aria-label={selectingOrigin ? "Search map departure airports" : "Search map destinations"}
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
                onClick={() => {
                  if (selectingOrigin) {
                    setOriginCode(place.code); setFares([]); setMaxPrice(null); setListOpen(false)
                    if (destination === place.code) setDestination(null)
                    if (active === place.code) setActive(place.code === "BKK" ? "KUL" : "BKK")
                  } else choosePlace(place.code, true)
                }}
              >
                <strong>
                  {place.city}{" "}
                  <small>
                    {place.code} · {place.country}
                  </small>
                </strong>
                <span>{selectingOrigin ? (place.code === originCode ? "Selected" : "Depart here") : money(byCode.get(place.code))} →</span>
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
              <p className="explore-map-route-label">{originCode} → {selected.code}</p>
              {selectedFare?.durationMinutes != null && Number.isFinite(selectedFare.durationMinutes) && selectedFare.durationMinutes > 0 ? <p className="explore-map-flight-duration">{Math.floor(selectedFare.durationMinutes / 60) > 0 ? `${Math.floor(selectedFare.durationMinutes / 60)}h ` : ''}{selectedFare.durationMinutes % 60 > 0 ? `${selectedFare.durationMinutes % 60}m` : ''}{selectedFare.stops != null && ` · ${selectedFare.stops === 0 ? 'Non-stop' : `${selectedFare.stops} stop${selectedFare.stops === 1 ? '' : 's'}`}`}</p> : <p className="explore-map-flight-duration is-unavailable">Search flights to see duration</p>}
              <span title={selectedFare ? `One adult · Economy · One-way · ${selectedFare.currency} · Shopping fare, subject to recheck` : selected.name}>
                {selectedFare
                  ? `Travel ${selectedFare.departureDate} · Checked ${new Date(selectedFare.searchedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
                  : selected.name}
              </span>
            </div>
            <strong>{selectedFare && <small className="explore-map-cached-label">Cached fare</small>}{money(selectedFare)}</strong>
            <Link to={homeSearchUrl({ ...search, departure: departureDate || selectedFare?.departureDate || "" }, selected.code) + "&currency=" + currency}>
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
      <p id="explore-map-instructions" className="sr-only">
        Drag to explore · Scroll or pinch to zoom · Arrow keys to move · Home
        for the world view. Explore destination ideas. Prices, when shown, are
        from recent searches; check live fares before booking.
      </p>
    </section>
  )
}
