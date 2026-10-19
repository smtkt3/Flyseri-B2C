import { useEffect, useState } from 'react';
import type { GuideDocument } from './visa-guide-content';

export function VisaDocumentChecklist({ documents }: { documents: GuideDocument[] }) {
  const [mobile, setMobile] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set([0]));
  useEffect(() => {
    const query = window.matchMedia('(max-width:760px)');
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return <ol className="visa-reference-documents">{documents.map((item, index) =>
    <li key={item.title}><span>{index + 1}</span>
      <details className="visa-reference-document-details" open={!mobile || expanded.has(index)}>
        <summary tabIndex={mobile ? 0 : -1} onClick={event => {
          event.preventDefault();
          if (mobile) setExpanded(previous => {
            const next = new Set(previous);
            if (next.has(index)) next.delete(index); else next.add(index);
            return next;
          });
        }}><h3>{item.title}</h3>{item.condition && <small>{item.condition}</small>}</summary>
        <div className="visa-reference-document-body">{item.paragraphs.map((paragraph, i) => <p key={i}>{paragraph}</p>)}</div>
      </details>
    </li>
  )}</ol>;
}
