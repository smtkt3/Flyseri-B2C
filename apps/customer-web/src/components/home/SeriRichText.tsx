import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import airports from './map-airports.json';
import { homeSearchUrl, updateHomeSearch, useHomeSearchDraft } from './homeSearchDraft';

function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    return link ? <a key={index} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a> : <Fragment key={index}>{part}</Fragment>;
  });
}
export function SeriRichText({ content, onFlightSearch, hideFlightLinks = false }: { content: string; onFlightSearch?: (city: string, code: string) => void; hideFlightLinks?: boolean }) {
  const search = useHomeSearchDraft();
  const lines = content.split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const list = line.match(/^(\d+\.|[-*])\s+(.+)/);
    if (list) {
      const ordered = /^\d/.test(list[1]!);
      const items = [list[2]!];
      while (i + 1 < lines.length) {
        const next = lines[i + 1]!.trim().match(ordered ? /^\d+\.\s+(.+)/ : /^[-*]\s+(.+)/);
        if (!next) break;
        items.push(next[1]!); i++;
      }
      const children = items.map((item, index) => <li key={index}>{inline(item)}</li>);
      blocks.push(ordered ? <ol key={i}>{children}</ol> : <ul key={i}>{children}</ul>);
    } else if (/^#{1,3}\s/.test(line)) blocks.push(<h4 key={i}>{inline(line.replace(/^#{1,3}\s+/, ''))}</h4>);
    else blocks.push(<p key={i}>{inline(line)}</p>);
  }
  const suggestions = airports.filter(place => place.code !== search.origin && new RegExp('\\b' + place.city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(content));
  const unique = suggestions.filter((place, index) => suggestions.findIndex(other => other.city === place.city) === index).slice(0, 4);
  return <div className="seri-rich-text">{blocks}{!hideFlightLinks && unique.length > 0 && <div className="seri-destination-actions">{unique.map(place => onFlightSearch ? <button type="button" key={place.code} onClick={() => onFlightSearch(place.city, place.code)}>Flights to {place.city} ↗</button> : <Link key={place.code} to={homeSearchUrl(search, place.code)} onClick={() => updateHomeSearch({ destination: place.code })}>Flights to {place.city} ↗</Link>)}</div>}</div>;
}
