import { ChatAircraftIcon } from './ChatAircraftIcon';
import './chat-aircraft-motion.css';

export function ChatAircraftMotion() {
  return <span className="seri-aircraft-motion" aria-hidden="true">
    <span className="seri-aircraft-exhaust seri-aircraft-exhaust-left">{Array.from({ length: 6 }, (_, index) => <i key={index} style={{ animationDelay: `${index * -110}ms` }}/>)}</span>
    <span className="seri-aircraft-exhaust seri-aircraft-exhaust-right">{Array.from({ length: 6 }, (_, index) => <i key={index} style={{ animationDelay: `${index * -110 - 55}ms` }}/>)}</span>
    <span className="seri-aircraft-flame seri-aircraft-flame-left"/><span className="seri-aircraft-flame seri-aircraft-flame-right"/>
    <ChatAircraftIcon/>
  </span>;
}
