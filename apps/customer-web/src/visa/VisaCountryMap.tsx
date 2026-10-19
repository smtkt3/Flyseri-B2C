import { useEffect, useRef, useState } from 'react';
import destinationBoundaries from './destination-boundaries.json';

// Natural Earth 1:50m admin-0 outlines, public domain. Cartographic outlines are illustrative.
// https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_50m_admin_0_countries.geojson
const mercatorPoint = (lon:number,lat:number) => {
  const sin=Math.sin(Math.max(-85.05112878,Math.min(85.05112878,lat))*Math.PI/180);
  return {x:(lon+180)/360,y:.5-Math.log((1+sin)/(1-sin))/(4*Math.PI)};
};
type Boundary=number[][][][];
const boundaries=destinationBoundaries as Record<string,Boundary>;

const views:Record<string,{lat:number;lon:number;zoom:number}>={
  MY:{lat:4.5,lon:109,zoom:5},TH:{lat:15,lon:101,zoom:5},SG:{lat:1.35,lon:103.82,zoom:11},
  AE:{lat:24,lon:54,zoom:7},IN:{lat:22,lon:80,zoom:4},SA:{lat:24,lon:45,zoom:5},
  TR:{lat:39,lon:35,zoom:5},CN:{lat:35,lon:104,zoom:3},JP:{lat:37,lon:138,zoom:5},
  GB:{lat:55,lon:-3,zoom:5},ID:{lat:-3,lon:118,zoom:4},PK:{lat:30,lon:69,zoom:5},
  LK:{lat:7.9,lon:80.7,zoom:7},LA:{lat:18,lon:103,zoom:6},KH:{lat:12.5,lon:105,zoom:6},
};
export function VisaCountryMap({code,name}:{code:string;name:string}) {
  const frame=useRef<HTMLDivElement>(null);
  const view=views[code];
  const [chosenZoom,setZoom]=useState<number|null>(null);
  const [size,setSize]=useState({width:0,height:0});
  const [unavailable,setUnavailable]=useState(false);
  useEffect(()=>{setZoom(null);setUnavailable(false);},[code]);
  useEffect(()=>{
    const node=frame.current;
    if(!node) return;
    const measure=()=>setSize({width:node.clientWidth,height:node.clientHeight});
    measure();
    const observer=new ResizeObserver(measure);observer.observe(node);
    return ()=>observer.disconnect();
  },[]);
  const boundary=boundaries[code];
  const points=boundary?.flat(2).map(point=>mercatorPoint(point[0]!,point[1]!)) || [];
  const bounds=points.length ? {left:Math.min(...points.map(point=>point.x)),right:Math.max(...points.map(point=>point.x)),top:Math.min(...points.map(point=>point.y)),bottom:Math.max(...points.map(point=>point.y))} : null;
  const fittedZoom=bounds && size.width>0 ? Math.max(2,Math.min(12,Math.floor(Math.min(
    Math.log2(Math.max(1,size.width-64)/((bounds.right-bounds.left)*256)),
    Math.log2(Math.max(1,size.height-96)/((bounds.bottom-bounds.top)*256)),
  )))) : view.zoom;
  const zoom=chosenZoom??fittedZoom;
  const count=2**zoom,world=count*256;
  const center=bounds ? {x:(bounds.left+bounds.right)/2,y:(bounds.top+bounds.bottom)/2} : mercatorPoint(view.lon,view.lat);
  const left=center.x*world-size.width/2;
  const top=center.y*world-size.height/2;
  const outline=boundary ? boundary.map(polygon=>polygon.map(ring=>ring.map((point,index)=>{
    const projected=mercatorPoint(point[0]!,point[1]!);
    return `${index?'L':'M'}${(projected.x*world-left).toFixed(2)},${(projected.y*world-top).toFixed(2)}`;
  }).join(' ')+' Z').join(' ')).join(' ') : '';
  const tiles:Array<{key:string;x:number;y:number;left:number;top:number}>=[];
  if(size.width>0) for(let y=Math.max(0,Math.floor(top/256));y<=Math.min(count-1,Math.floor((top+size.height)/256));y++){
    for(let x=Math.floor(left/256);x<=Math.floor((left+size.width)/256);x++){
      tiles.push({key:`${zoom}-${x}-${y}`,x:((x%count)+count)%count,y,left:x*256-left,top:y*256-top});
    }
  }
  return <div ref={frame} className="visa-country-map" role="group" aria-label={'Map of '+name}>
    <div className="visa-country-map-tiles" aria-hidden="true">{tiles.map(tile=><img key={tile.key} src={`https://tile.openstreetmap.org/${zoom}/${tile.x}/${tile.y}.png`} alt="" loading="lazy" draggable={false} style={{left:tile.left,top:tile.top}} onError={()=>setUnavailable(true)}/>)}</div>
    {bounds && size.width>0 && <svg className="visa-country-map-highlight" viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true">
      <path d={`M0,0 H${size.width} V${size.height} H0 Z ${outline}`} fill="white" fillOpacity=".25" fillRule="evenodd"/>
      <path d={outline} fill="#4b9cff" fillOpacity=".28" fillRule="evenodd" stroke="#1767cc" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
    </svg>}
    <div className="visa-country-map-label"><strong>{name}</strong><span>{boundary ? 'Highlighted destination' : unavailable ? 'Explore your destination' : 'Destination map'}</span></div>
    <div className="visa-country-map-controls"><button type="button" aria-label="Zoom in on destination map" disabled={zoom>=12} onClick={()=>{setUnavailable(false);setZoom(value=>Math.min(12,(value??fittedZoom)+1));}}>+</button><button type="button" aria-label="Zoom out on destination map" disabled={zoom<=2} onClick={()=>{setUnavailable(false);setZoom(value=>Math.max(2,(value??fittedZoom)-1));}}>−</button></div>
    <a className="visa-country-map-open" href={'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(name)} target="_blank" rel="noreferrer">Open in Google Maps ↗</a>
    <a className="visa-country-map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
  </div>;
}
