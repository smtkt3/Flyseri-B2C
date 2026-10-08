import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import type { HolidayPackage } from '@flyseri/types';
import { holidayMoney, holidayService } from './holidayService';
import { holidayPhotoCredits, previewHolidayPackages } from '../data/demo/holidayPackages';
import './holiday.css';
import './holiday-carousel.css';

export function useHolidayPackages() {
  const [packages, setPackages] = useState<HolidayPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, retry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setFailed(false);
    holidayService.list(controller.signal).then(items => { if (!controller.signal.aborted) setPackages(items); }).catch(() => { if (!controller.signal.aborted) setFailed(true); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  const preview = !loading && !packages.length;
  return { packages: preview ? previewHolidayPackages : packages, loading, failed, preview, retry: () => retry(n => n + 1) };
}
export function HolidayPackageCard({ item }: { item: HolidayPackage }) {
  return <Link className="holiday-card" to={`/holidays/${item.id}`}>
    <div className="holiday-card-image"><img src={item.imageUrl} alt={item.location} loading="lazy"/><span>{item.days} days · {item.nights} nights</span></div>
    <div className="holiday-card-body"><p>{item.location}</p><h3>{item.title}</h3><div className="holiday-card-foot"><div><small>{item.preview ? 'Sample price per adult' : 'From / adult'}</small><strong>{holidayMoney(item.adultPrice)}</strong></div><span className="holiday-arrow" aria-hidden="true">↗</span></div></div>
  </Link>;
}
export function HolidayPackageSlideshow({ items }: { items: HolidayPackage[] }) {
  const [active, setActive] = useState(() => Math.min(2, items.length - 1));
  const [paused, setPaused] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [holdUntil, setHoldUntil] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const count = items.length;
  const selected = active % count;
  const select = (index: number) => { setHoldUntil(Date.now() + 2000); setActive(index); };
  const move = (direction: number) => { setHoldUntil(Date.now() + 2000); setActive(index => (index + direction + count) % count); };
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(!!media?.matches);
    update(); media?.addEventListener('change', update);
    const element = root.current;
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => setVisible(entries[0]?.isIntersecting ?? false), { threshold: 0.25 });
    if (element && observer) observer.observe(element); else setVisible(true);
    return () => { media?.removeEventListener('change', update); observer?.disconnect(); };
  }, []);
  useEffect(() => {
    if (paused || interacting || reduced || !visible || count < 2) return;
    let timer: number;
    const advance = () => {
      if (!document.hidden) setActive(index => (index + 1) % count);
      timer = window.setTimeout(advance, 1500);
    };
    timer = window.setTimeout(advance, Math.max(1500, holdUntil - Date.now()));
    return () => window.clearTimeout(timer);
  }, [active, count, paused, interacting, reduced, visible, holdUntil]);
  return <div ref={root} className="holiday-carousel" role="region" aria-roledescription="carousel" aria-label="Holiday tour packages slideshow"
    onMouseEnter={() => setInteracting(true)} onMouseLeave={() => setInteracting(false)} onFocusCapture={event => { if (!(event.target as HTMLElement).closest('.holiday-playback')) setInteracting(true); }} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setInteracting(false); }}
    onKeyDown={event => { if (event.key === ' ' && !(event.target as HTMLElement).closest('button')) { event.preventDefault(); setPaused(value => !value); } if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); move(event.key === 'ArrowRight' ? 1 : -1); } }}>
    <div className="holiday-carousel-stage" onPointerDown={event => { gesture.current = { x: event.clientX, y: event.clientY }; swiped.current = false; }} onPointerCancel={() => { gesture.current = null; }}
      onPointerUp={event => { const start = gesture.current; gesture.current = null; if (!start) return; const dx = event.clientX - start.x, dy = event.clientY - start.y; if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2) { swiped.current = true; move(dx < 0 ? 1 : -1); } }}
      onClickCapture={event => { if (swiped.current) { event.preventDefault(); event.stopPropagation(); swiped.current = false; } }}>
      {items.map((item, index) => {
        let offset = (index - selected + count) % count;
        if (offset > count / 2) offset -= count;
        const distance = Math.abs(offset);
        const style = { '--slide-offset': offset, '--slide-rotation': `${offset === 0 ? 0 : offset < 0 ? 24 : -24}deg`, '--slide-scale': distance === 0 ? 1 : distance === 1 ? .94 : .83, zIndex: 10 - distance } as CSSProperties;
        const content = <><img src={item.imageUrl} alt="" loading={distance <= 1 ? 'eager' : 'lazy'} draggable={false}/><div className="holiday-slide-caption"><span>{item.days} days · {item.nights} nights</span><h3>{item.location}</h3><p>{item.title}</p><strong>{holidayMoney(item.adultPrice)} <small>/ adult{item.preview ? ' · sample' : ''}</small></strong></div></>;
        return <Link key={item.id} draggable={false} className={`holiday-slide${offset === 0 ? ' is-active' : ''}${distance > 2 ? ' is-hidden' : ''}`} style={style} to={`/holidays/${item.id}`} tabIndex={offset === 0 ? 0 : -1} aria-hidden={distance > 2} aria-label={offset === 0 ? `${item.title}, ${item.location}, view package` : `Preview ${item.location}`} onClick={event => { if (offset !== 0) { event.preventDefault(); select(index); } }}>{content}</Link>;
      })}
    </div>
    <div className="holiday-playback"><button type="button" aria-label={paused ? 'Resume holiday slideshow' : 'Pause holiday slideshow'} aria-pressed={paused} onClick={() => setPaused(value => !value)}><span aria-hidden="true">{paused ? '▶' : 'Ⅱ'}</span>{paused ? 'Play' : 'Pause'}</button></div>
    <div className="holiday-mobile-dots" aria-label="Choose a holiday package">{items.map((item, index) => <button key={item.id} type="button" aria-label={`Show ${item.location}`} aria-pressed={selected === index} onClick={() => select(index)}/>)}</div>
    <HolidayPhotoCredit id={items[selected]!.id}/>
  </div>;
}
export function HolidayPhotoCredit({ id }: { id: string }) {
  const credit = holidayPhotoCredits[id];
  return credit ? <small className="holiday-photo-credit">Photo: <a href={credit.source} target="_blank" rel="noreferrer">{credit.author}</a> · <a href={credit.license} target="_blank" rel="noreferrer">CC BY-SA 4.0</a> · cropped to fit</small> : null;
}
export function HolidayPackages({ full = false }: { full?: boolean }) {
  const { packages, loading, failed, preview, retry } = useHolidayPackages();
  const [category, setCategory] = useState<'DOMESTIC' | 'INTERNATIONAL'>('DOMESTIC');
  const items = packages.filter(p => p.category === category);
  return <section className={`holiday-section${full ? '' : ' holiday-showcase'}`} id="holidays" aria-labelledby="holiday-heading">
    <div className="holiday-section-heading"><div><h2 id="holiday-heading">Holiday tour packages</h2></div>{!full && <Link to="/holidays">Explore all packages <span aria-hidden="true">↗</span></Link>}</div>
    <div className="holiday-tabs" role="tablist" aria-label="Holiday destinations"><button id="holiday-domestic-tab" role="tab" aria-selected={category === 'DOMESTIC'} aria-controls="holiday-results" onClick={() => setCategory('DOMESTIC')}>Bangladesh</button><button id="holiday-international-tab" role="tab" aria-selected={category === 'INTERNATIONAL'} aria-controls="holiday-results" onClick={() => setCategory('INTERNATIONAL')}>International</button></div>
    {preview && <p className="holiday-preview-note">Sample packages · not bookable</p>}
    <div id="holiday-results" role="tabpanel" aria-labelledby={`holiday-${category.toLowerCase()}-tab`}>
      {loading ? <div className={`holiday-loading${full ? ' is-grid' : ''}`} role="status" aria-label="Loading holiday packages"><span className="sr-only">Finding your next getaway…</span>{[0, 1, 2].map(index => <div key={index} aria-hidden="true"/>)}</div> : items.length ? full ? <div className="holiday-grid">{items.map(item => <HolidayPackageCard item={item} key={item.id}/>)}</div> : <HolidayPackageSlideshow items={items} key={category}/> : <div className="holiday-empty"><h3>{failed ? 'Packages are temporarily unavailable' : 'New getaways are on the way'}</h3><p>{failed ? 'Please try again shortly.' : 'Our team is preparing holidays for you. Check back soon.'}</p>{failed && <button onClick={retry}>Try again</button>}</div>}
    </div>
    {full && preview && <HolidayPhotoCredit id="preview-dhaka"/>}
  </section>;
}
