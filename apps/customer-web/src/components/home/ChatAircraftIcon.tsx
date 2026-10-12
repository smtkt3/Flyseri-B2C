import aircraftRender from '../../assets/seri-aircraft-render.png';

/** Shared transparent render keeps desktop and mobile aircraft visually identical. */
export function ChatAircraftIcon() {
  return <img className="seri-launcher-aircraft" src={aircraftRender} width={84} height={84} alt="" aria-hidden="true" draggable={false} decoding="async" />;
}
