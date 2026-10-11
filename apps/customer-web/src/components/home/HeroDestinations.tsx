import { useEffect, useState } from 'react';

const slides = [
  { name: 'Santorini, Greece', image: 'photo-1570077188670-e3a8d69ac5ff', position: 'center 57%' },
  { name: 'Bali, Indonesia', image: 'photo-1537996194471-e657df975ab4', position: 'center 55%' },
  { name: 'Maldives', image: 'photo-1514282401047-d79a71a590e8', position: 'center 50%' },
  { name: 'Swiss Alps, Switzerland', image: 'photo-1506905925346-21bda4d32df4', position: 'center 55%' },
];
const imageUrl = (image: string, width: number) => `https://images.unsplash.com/${image}?w=${width}&q=82&fit=crop&auto=format`;

export function HeroDestinations() {
  const [active, setActive] = useState(0);
  const [loaded, setLoaded] = useState<number[]>([]);
  const [requested, setRequested] = useState(1);
  const paused = false;
  const [visible, setVisible] = useState(() => !document.hidden);
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (reduced || !visible || paused || requested >= slides.length || !loaded.includes(requested - 1)) return;
    const timer = window.setTimeout(() => setRequested(count => count + 1), 1800);
    return () => window.clearTimeout(timer);
  }, [loaded, requested, reduced, visible, paused]);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => setReduced(preference.matches);
    const updateVisibility = () => setVisible(!document.hidden);
    preference.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      preference.removeEventListener('change', updateMotion);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);
  useEffect(() => {
    if (paused || reduced || !visible) return;
    const timer = window.setInterval(() => setActive(current => {
      for (let offset = 1; offset < slides.length; offset += 1) {
        const next = (current + offset) % slides.length;
        if (loaded.includes(next)) return next;
      }
      return current;
    }), 8000);
    return () => window.clearInterval(timer);
  }, [paused, reduced, visible, loaded]);
  const slide = slides[active]!;
  return <>
    <div className="premium-hero-photo premium-hero-slideshow" role="img" aria-label={slide.name}>
      {slides.slice(0, requested).map((item, index) => <img key={item.image} className={index === active ? 'is-active' : ''} src={imageUrl(item.image, 800)} srcSet={`${imageUrl(item.image, 480)} 480w, ${imageUrl(item.image, 800)} 800w, ${imageUrl(item.image, 1280)} 1280w`} sizes="(max-width: 1366px) 100vw, 70vw" alt="" aria-hidden="true" decoding="async" fetchPriority={index === 0 ? 'high' : 'low'} style={{ objectPosition: item.position }} onLoad={() => setLoaded(current => current.includes(index) ? current : [...current, index])} />)}
    </div>
    <div className="premium-hero-note"><img src={imageUrl(slide.image, 100)} alt="" /><span>{slide.name}</span></div>
  </>;
}
