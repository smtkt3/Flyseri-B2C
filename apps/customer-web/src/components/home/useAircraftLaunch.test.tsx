// @vitest-environment jsdom
import { useRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AIRCRAFT_FLIGHT_PATTERNS, aircraftFlightFrames, useAircraftLaunch } from './useAircraftLaunch';

class TestPointerEvent extends MouseEvent {
  pointerId: number; isPrimary: boolean;
  constructor(type: string, options: PointerEventInit = {}) { super(type,options); this.pointerId=options.pointerId ?? 1; this.isPrimary=options.isPrimary ?? true; }
}
const animations: { resolve: () => void; cancel: ReturnType<typeof vi.fn> }[] = [];
function Launcher({open}:{open:()=>void}) {
  const ref=useRef<HTMLButtonElement>(null), flight=useAircraftLaunch(ref,open);
  return <button ref={ref} data-flight={flight.phase} data-boosted={flight.boosted} {...flight.handlers}>Chat<span className="seri-aircraft-motion"/></button>;
}
beforeEach(()=>{
  animations.length=0;
  vi.stubGlobal('PointerEvent',TestPointerEvent);
  vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));
  Object.defineProperty(Element.prototype,'animate',{configurable:true,value:vi.fn(()=>{
    let resolve!:()=>void; const finished=new Promise<void>(done=>{resolve=done;}); const cancel=vi.fn();
    animations.push({resolve,cancel}); return {finished,cancel};
  })});
});
afterEach(()=>{cleanup();delete (Element.prototype as Partial<Element>).animate;vi.unstubAllGlobals();vi.useRealTimers();});
function pull(distance:number) {
  const button=screen.getByRole('button');
  fireEvent.pointerDown(button,{clientY:100,button:0,pointerId:1,isPrimary:true});
  fireEvent.pointerMove(button,{clientY:100+distance,pointerId:1});
  fireEvent.pointerUp(button,{clientY:100+distance,pointerId:1});
  return button;
}
it('shakes, flies, returns and opens exactly once after a downward pull',async()=>{
  const open=vi.fn();render(<Launcher open={open}/>);
  const button=pull(40);
  expect(button.dataset.flight).toBe('shaking');expect(open).not.toHaveBeenCalled();
  fireEvent.click(button,{detail:1});expect(open).not.toHaveBeenCalled();
  await act(async()=>animations[0]!.resolve());
  expect(button.dataset.flight).toBe('flying');expect(animations).toHaveLength(2);
  await act(async()=>animations[1]!.resolve());
  expect(button.dataset.flight).toBe('landing'); expect(open).not.toHaveBeenCalled();
  expect(vi.mocked(Element.prototype.animate).mock.calls[2]![1]).toMatchObject({duration:900});
  await act(async()=>animations[2]!.resolve());
  expect(open).not.toHaveBeenCalled();
  await act(async()=>animations[3]!.resolve());
  expect(button.dataset.flight).toBe('idle');expect(open).toHaveBeenCalledTimes(1);
});
it('keeps tapping instant and ignores short or cancelled drags',()=>{
  const open=vi.fn();render(<Launcher open={open}/>);
  fireEvent.click(screen.getByRole('button'));expect(open).toHaveBeenCalledTimes(1);
  fireEvent.click(pull(10),{detail:1});expect(open).toHaveBeenCalledTimes(1);
  const button=screen.getByRole('button');fireEvent.pointerDown(button,{clientY:100,button:0});
  fireEvent.pointerMove(button,{clientY:150});fireEvent.pointerCancel(button);
  fireEvent.click(button,{detail:1});expect(animations).toHaveLength(0);expect(open).toHaveBeenCalledTimes(1);
});
it('skips flight for reduced motion and supports ArrowDown from the keyboard',()=>{
  vi.mocked(window.matchMedia).mockReturnValue({matches:true} as MediaQueryList);
  const open=vi.fn();render(<Launcher open={open}/>);
  pull(40);expect(open).toHaveBeenCalledTimes(1);expect(animations).toHaveLength(0);
  fireEvent.keyDown(screen.getByRole('button'),{key:'ArrowDown'});expect(open).toHaveBeenCalledTimes(2);
});
it('recovers if browser animation never completes and cancels on unmount',()=>{
  vi.useFakeTimers();const open=vi.fn();const view=render(<Launcher open={open}/>);
  pull(40);act(()=>vi.advanceTimersByTime(4000));expect(open).toHaveBeenCalledTimes(1);
  pull(40);view.unmount();act(()=>vi.advanceTimersByTime(3000));expect(open).toHaveBeenCalledTimes(1);
  expect(animations.at(-1)!.cancel).toHaveBeenCalled();
});
it.each([{width:320,height:568,left:250,top:420,size:46},{width:1440,height:900,left:1320,top:780,size:84}])('keeps sampled flight positions inside a $width px viewport',viewport=>{
  const frames=aircraftFlightFrames({left:viewport.left,top:viewport.top,width:viewport.size,height:viewport.size},viewport);
  expect(frames).toHaveLength(121);
  for(const frame of frames){
    const [,x,y]=/translate3d\(([-\d.]+)px,([-\d.]+)px/.exec(String(frame.transform))!;
    expect(viewport.left+Number(x)).toBeGreaterThanOrEqual(0);
    expect(viewport.top+Number(y)).toBeGreaterThanOrEqual(0);
    expect(viewport.left+Number(x)+viewport.size).toBeLessThanOrEqual(viewport.width);
    expect(viewport.top+Number(y)+viewport.size).toBeLessThanOrEqual(viewport.height);
  }
  expect(String(frames.at(-1)!.transform)).toMatch(/^translate3d\(0px,0px,0\) rotate\(/);
});

it('charges only while held down and releases into a faster flight', async()=>{
  vi.useFakeTimers(); const open=vi.fn(); render(<Launcher open={open}/>);
  const button=screen.getByRole('button');
  fireEvent.pointerDown(button,{clientY:100,button:0}); fireEvent.pointerMove(button,{clientY:140});
  act(()=>vi.advanceTimersByTime(1199)); expect(button.dataset.boosted).toBe('false');
  act(()=>vi.advanceTimersByTime(1)); expect(button.dataset.boosted).toBe('true'); expect(open).not.toHaveBeenCalled();
  fireEvent.pointerUp(button,{clientY:140}); await act(async()=>animations[0]!.resolve());
  expect(vi.mocked(Element.prototype.animate).mock.calls[1]![1]).toMatchObject({duration:1000});
  await act(async()=>animations[1]!.resolve()); expect(button.dataset.boosted).toBe('false'); expect(open).not.toHaveBeenCalled();
  expect(vi.mocked(Element.prototype.animate).mock.calls[2]![1]).toMatchObject({duration:900});
  await act(async()=>animations[2]!.resolve()); expect(open).not.toHaveBeenCalled();
  await act(async()=>animations[3]!.resolve()); expect(open).toHaveBeenCalledTimes(1);
});
it('clears the hold charge on moving back up and cancellation',()=>{
  vi.useFakeTimers(); render(<Launcher open={vi.fn()}/>); const button=screen.getByRole('button');
  fireEvent.pointerDown(button,{clientY:100,button:0}); fireEvent.pointerMove(button,{clientY:140});
  act(()=>vi.advanceTimersByTime(900)); fireEvent.pointerMove(button,{clientY:105});
  act(()=>vi.advanceTimersByTime(1200)); expect(button.dataset.boosted).toBe('false');
  fireEvent.pointerMove(button,{clientY:140}); act(()=>vi.advanceTimersByTime(1200)); expect(button.dataset.boosted).toBe('true');
  fireEvent.pointerCancel(button); expect(button.dataset.boosted).toBe('false'); expect(animations).toHaveLength(0);
});
it('approaches the dock nose-first and decelerates instead of reversing into place',()=>{
  const frames=aircraftFlightFrames({left:250,top:420,width:46,height:46},{width:320,height:568});
  const poses=frames.map(frame=>/translate3d\(([-\d.e]+)px,([-\d.e]+)px,0\) rotate\(([-\d.e]+)deg\)/.exec(String(frame.transform))!.slice(1).map(Number));
  for(let i=97;i<120;i++) {
    const current=poses[i]!, next=poses[i+1]!;
    const dx=next[0]!-current[0]!, dy=next[1]!-current[1]!;
    const heading=(current[2]!-60)*Math.PI/180;
    expect(dx*Math.cos(heading)+dy*Math.sin(heading)).toBeGreaterThan(0);
  }
  const finalHeading=(poses[120]![2]!-60)*Math.PI/180;
  expect(Math.cos(finalHeading)).toBeCloseTo(.5,3);
  expect(Math.sin(finalHeading)).toBeCloseTo(-Math.sqrt(3)/2,3);
  const distance=(a:number,b:number)=>Math.hypot(poses[a]![0]!-poses[b]![0]!,poses[a]![1]!-poses[b]![1]!);
  expect(distance(119,120)).toBeLessThan(distance(115,116));
});

it.each(AIRCRAFT_FLIGHT_PATTERNS)('keeps %s smooth and bounded on compact phones and desktop',pattern=>{
  for(const viewport of [{width:320,height:568,left:250,top:490,size:46},{width:1440,height:900,left:1320,top:780,size:84}]) {
    for(const boosted of [false,true]) {
      const frames=aircraftFlightFrames({left:viewport.left,top:viewport.top,width:viewport.size,height:viewport.size},viewport,pattern,boosted);
      const poses=frames.map(frame=>/translate3d\(([-\d.e]+)px,([-\d.e]+)px,0\) rotate\(([-\d.e]+)deg\)/.exec(String(frame.transform))!.slice(1).map(Number));
      for(let i=1;i<poses.length;i++) {
        const [x,y,angle]=poses[i]!, before=poses[i-1]!;
        expect(viewport.left+x!).toBeGreaterThanOrEqual(0);
        expect(viewport.top+y!).toBeGreaterThanOrEqual(0);
        expect(viewport.left+x!+viewport.size).toBeLessThanOrEqual(viewport.width);
        expect(viewport.top+y!+viewport.size).toBeLessThanOrEqual(viewport.height);
        expect(Math.abs(angle!-before[2]!)).toBeLessThan(25);
        if(i>6) {
          const dx=x!-before[0]!,dy=y!-before[1]!,heading=(angle!-60)*Math.PI/180;
          expect(dx*Math.cos(heading)+dy*Math.sin(heading)).toBeGreaterThan(0);
        }
      }
    }
  }
});

it('gives each flight pattern a distinct route',()=>{
  const routes=AIRCRAFT_FLIGHT_PATTERNS.map(pattern=>aircraftFlightFrames({left:250,top:490,width:46,height:46},{width:320,height:568},pattern).map(frame=>frame.transform).join('|'));
  expect(new Set(routes).size).toBe(AIRCRAFT_FLIGHT_PATTERNS.length);
});
