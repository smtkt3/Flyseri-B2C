export type MapPoint = { x: number; y: number }
export type MapView = { lon: number; lat: number; zoom: number }
export type MapViewport = { width: number; height: number }
export const WORLD_VIEW: MapView = { lon: 0, lat: 15, zoom: 1 }
export const wrapLongitude = (lon: number) =>
  ((((lon + 180) % 360) + 360) % 360) - 180
export const mercatorY = (lat: number) =>
  (1 -
    Math.asinh(
      Math.tan(
        (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180,
      ),
    ) /
      Math.PI) /
  2
export const latitudeAtY = (y: number) =>
  (Math.atan(Math.sinh(Math.PI * (1 - 2 * Math.max(0, Math.min(1, y))))) *
    180) /
  Math.PI
export const worldSize = (view: MapView, viewport: MapViewport) =>
  Math.max(256, viewport.width, viewport.height) * view.zoom
/** Keep the vertical world edges outside the visible map area while panning or resizing. */
export function clampMapView(view: MapView, viewport: MapViewport): MapView {
  const world = worldSize(view, viewport)
  const inset = Math.min(0.5, viewport.height / (2 * world))
  const centerY = mercatorY(view.lat)
  const boundedY = Math.max(inset, Math.min(1 - inset, centerY))
  return boundedY === centerY ? view : { ...view, lat: latitudeAtY(boundedY) }
}
export function projectAirport(
  lon: number,
  lat: number,
  view: MapView,
  viewport: MapViewport,
): MapPoint {
  const world = worldSize(view, viewport)
  return {
    x: (wrapLongitude(lon - view.lon) / 360) * world + viewport.width / 2,
    y: (mercatorY(lat) - mercatorY(view.lat)) * world + viewport.height / 2,
  }
}
/** Move an anchor to a new screen point, preserving its geographic position during zoom. */
export function transformMap(
  view: MapView,
  viewport: MapViewport,
  from: MapPoint,
  to: MapPoint,
  factor = 1,
): MapView {
  const zoom = Math.max(1, Math.min(32, view.zoom * factor))
  const oldWorld = worldSize(view, viewport),
    nextWorld = worldSize({ ...view, zoom }, viewport)
  const longitude = view.lon + ((from.x - viewport.width / 2) / oldWorld) * 360
  const y = mercatorY(view.lat) + (from.y - viewport.height / 2) / oldWorld
  return clampMapView({
    lon: wrapLongitude(
      longitude - ((to.x - viewport.width / 2) / nextWorld) * 360,
    ),
    lat: latitudeAtY(y - (to.y - viewport.height / 2) / nextWorld),
    zoom,
  }, viewport)
}
export type LabelBox = MapPoint & {
  width: number
  height: number
  code: string
  anchor: MapPoint
}
const intersects = (
  a: Omit<LabelBox, "code" | "anchor">,
  b: Omit<LabelBox, "code" | "anchor">,
) =>
  a.x < b.x + b.width + 7 &&
  a.x + a.width + 7 > b.x &&
  a.y < b.y + b.height + 7 &&
  a.y + a.height + 7 > b.y
export function layoutMapLabels(
  points: { code: string; point: MapPoint }[],
  viewport: MapViewport,
  mobile: boolean,
  blocked: Omit<LabelBox, "code" | "anchor">[] = [],
): LabelBox[] {
  const width = mobile ? 90 : 120,
    height = mobile ? 44 : 58
  const result: LabelBox[] = []
  for (const { code, point } of points) {
    for (const distance of [14, 45, 85, 125]) {
      const candidates = [
        { x: point.x + distance, y: point.y - height - distance },
        { x: point.x - width - distance, y: point.y - height - distance },
        { x: point.x + distance, y: point.y + distance },
        { x: point.x - width - distance, y: point.y + distance },
        { x: point.x - width / 2, y: point.y - height - distance },
        { x: point.x - width / 2, y: point.y + distance },
      ]
      const candidate = candidates.find(
        (box) =>
          box.x >= 8 &&
          box.y >= 8 &&
          box.x + width < viewport.width - 8 &&
          box.y + height < viewport.height - 8 &&
          !result.some((other) =>
            intersects({ ...box, width, height }, other),
          ) &&
          !blocked.some((other) =>
            intersects({ ...box, width, height }, other),
          ),
      )
      if (candidate) {
        result.push({ ...candidate, code, width, height, anchor: point })
        break
      }
    }
    if (result.length >= (mobile ? 5 : 10)) break
  }
  return result
}
