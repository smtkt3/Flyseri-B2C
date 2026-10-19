import { useEffect, useState } from 'react';
import { useDataSaving } from '../components/home/useDataSaving';
import './visa-hero-slideshow.css';
import destinationPhotos from './destination-photos.json';
interface Slide {src:string;label:string;position:string;creditUrl?:string;author?:string;license?:string}
const countrySlides=destinationPhotos as Record<string,Slide[]>;

const malaysiaSlides:Slide[] = [
  {src:'https://images.unsplash.com/photo-1596422846543-75c6fc197f07',label:'Kuala Lumpur skyline',position:'center 48%'},
  {src:'https://images.unsplash.com/photo-1602427384420-71c70e2b2a2f',label:'Kuala Lumpur by day',position:'center 45%'},
];
const photoUrl = (src:string,width:number) => {
  if(src.includes('images.unsplash.com'))return `${src}?auto=format&fit=crop&w=${width}&q=80`;
  const url=new URL(src);
  const filename=url.pathname.split('/').pop();
  return `${url.origin}${url.pathname.replace('/commons/','/commons/thumb/')}/${width}px-${filename}`;
};

/** Decorative photography only: the visa information remains ordinary page content. */
export function VisaHeroSlideshow({countryCode}:{countryCode:string}) {
  const slides=countryCode==='MY'?malaysiaSlides:countrySlides[countryCode] || [];
  const [active,setActive] = useState(0);
  const [loaded,setLoaded] = useState<number[]>([]);
  const [failed,setFailed] = useState<number[]>([]);
  const [requested,setRequested] = useState(1);
  const [visible,setVisible] = useState(()=>!document.hidden);
  const [reduced,setReduced] = useState(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const dataSaving = useDataSaving();
  useEffect(()=>{
    const preference=window.matchMedia('(prefers-reduced-motion: reduce)');
    const motion=()=>setReduced(preference.matches);
    const visibility=()=>setVisible(!document.hidden);
    preference.addEventListener('change',motion); document.addEventListener('visibilitychange',visibility);
    return ()=>{preference.removeEventListener('change',motion);document.removeEventListener('visibilitychange',visibility);};
  },[]);
  useEffect(()=>{
    if(!slides.length || dataSaving || reduced || !visible || (!loaded.length && !failed.length))return;
    const timer=window.setTimeout(()=>setRequested(slides.length),1200);
    return ()=>window.clearTimeout(timer);
  },[countryCode,slides.length,dataSaving,reduced,visible,loaded.length,failed.length]);
  useEffect(()=>{
    if(failed.includes(active) && loaded.length)setActive(loaded[0]!);
  },[failed,loaded,active]);
  useEffect(()=>{
    if(!slides.length || reduced || dataSaving || !visible || loaded.length<2)return;
    const timer=window.setInterval(()=>setActive(current=>{
      const index=loaded.indexOf(current);
      return loaded[(index+1)%loaded.length]!;
    }),7000);
    return ()=>window.clearInterval(timer);
  },[countryCode,slides.length,reduced,dataSaving,visible,loaded]);
  if(!slides.length)return null;
  const currentSlide=slides[active];
  return <>
    <div className="visa-hero-photo-stage" aria-hidden="true">
      {slides.slice(0,requested).map((slide,index)=>!failed.includes(index) && <img key={slide.src} className={active===index&&loaded.includes(index)?'is-active':''} src={photoUrl(slide.src,1280)} srcSet={[960,1280,1920].map(width=>`${photoUrl(slide.src,width)} ${width}w`).join(', ')} sizes="(max-width:1100px) 100vw, 80vw" alt="" decoding="async" fetchPriority={index===0?'high':'low'} style={{objectPosition:slide.position}} onLoad={()=>setLoaded(current=>current.includes(index)?current:[...current,index])} onError={()=>setFailed(current=>current.includes(index)?current:[...current,index])}/>)}
    </div>
    {currentSlide?.creditUrl && loaded.includes(active) && <a className="visa-hero-photo-credit" href={currentSlide.creditUrl} target="_blank" rel="noreferrer" title={`${currentSlide.label} · ${currentSlide.author || 'Wikimedia Commons'} · ${currentSlide.license || 'Photo licensing'}`}>Photo: {currentSlide.author || 'Wikimedia Commons'} · {currentSlide.license} ↗</a>}
  </>;
}
