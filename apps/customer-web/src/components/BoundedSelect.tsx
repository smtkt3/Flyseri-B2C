import { Chevron } from './Chevron';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface BoundedSelectOption { value: string; label: string }
interface BoundedSelectProps {
  value: string;
  options: BoundedSelectOption[];
  placeholder: string;
  onChange: (value: string) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  ariaLabel?: string;
  menuMinWidth?: number;
  required?: boolean;
  disabled?: boolean;
  controlId?: string;
  invalid?: boolean;
  describedBy?: string;
}

export function BoundedSelect({value,options,placeholder,onChange,searchable=false,searchPlaceholder='Search…',ariaLabel,menuMinWidth=0,required=false,disabled=false,controlId,invalid,describedBy}:BoundedSelectProps) {
  const id=useId();
  const trigger=useRef<HTMLButtonElement>(null);
  const panel=useRef<HTMLDivElement>(null);
  const search=useRef<HTMLInputElement>(null);
  const [open,setOpen]=useState(false);
  const [query,setQuery]=useState('');
  const [position,setPosition]=useState<{top:number;left:number;width:number;maxHeight:number}>({top:0,left:0,width:0,maxHeight:240});
  const selected=options.find(option=>option.value===value);
  const filtered=searchable&&query.trim()?options.filter(option=>option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())||option.value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())):options;

  useEffect(()=>{if(disabled)setOpen(false);},[disabled]);

  useLayoutEffect(()=>{
    if(!open||!trigger.current)return;
    const place=()=>{
      const rect=trigger.current?.getBoundingClientRect();if(!rect)return;
      const viewport=window.visualViewport;
      const viewportTop=viewport?.offsetTop??0,viewportLeft=viewport?.offsetLeft??0;
      const viewportHeight=viewport?.height??window.innerHeight,viewportWidth=viewport?.width??window.innerWidth;
      const gutter=8,gap=5,maxHeight=Math.max(44,Math.min(260,viewportHeight-gutter*2));
      const below=viewportTop+viewportHeight-rect.bottom-gap-gutter,above=rect.top-viewportTop-gap-gutter;
      const flip=below<Math.min(210,maxHeight)&&above>below;
      const height=Math.max(44,Math.min(maxHeight,flip?above:below));
      const width=Math.min(Math.max(rect.width,menuMinWidth),viewportWidth-gutter*2);
      const top=Math.min(viewportTop+viewportHeight-gutter-height,Math.max(viewportTop+gutter,flip?rect.top-gap-height:rect.bottom+gap));
      setPosition({top,left:Math.max(viewportLeft+gutter,Math.min(rect.left,viewportLeft+viewportWidth-gutter-width)),width,maxHeight:height});
    };
    place();
    window.addEventListener('resize',place);
    window.addEventListener('scroll',place,true);
    window.visualViewport?.addEventListener('resize',place);
    window.visualViewport?.addEventListener('scroll',place);
    return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);window.visualViewport?.removeEventListener('resize',place);window.visualViewport?.removeEventListener('scroll',place);};
  },[open]);

  useEffect(()=>{
    if(!open)return;
    if(searchable)search.current?.focus();
    else (panel.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? panel.current?.querySelector<HTMLElement>('[role="option"]'))?.focus();
    const closeOutside=(event:PointerEvent)=>{
      const target=event.target as Node;
      if(!trigger.current?.contains(target)&&!panel.current?.contains(target))setOpen(false);
    };
    const closeEscape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);trigger.current?.focus();}};
    document.addEventListener('pointerdown',closeOutside);
    document.addEventListener('keydown',closeEscape);
    return()=>{document.removeEventListener('pointerdown',closeOutside);document.removeEventListener('keydown',closeEscape);};
  },[open,searchable]);

  const menu=open?createPortal(<div ref={panel} className="bounded-select-menu" style={position} onKeyDown={event=>{
    if(event.key==='Tab'){setOpen(false);trigger.current?.focus();return;}
    const options=Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not([disabled])')??[]);
    const current=options.indexOf(document.activeElement as HTMLButtonElement);
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key)||(!options.length)||current<0&&!['ArrowDown','ArrowUp'].includes(event.key))return;
    event.preventDefault();
    const next=event.key==='Home'?0:event.key==='End'?options.length-1:event.key==='ArrowDown'?(current+1)%options.length:(current<=0?options.length:current)-1;
    options[next]?.focus();
  }}>
    {searchable&&<input ref={search} className="bounded-select-search" type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} />}
      <div id={`${id}-options`} role="listbox" aria-label={ariaLabel??placeholder} aria-required={required}>
      {filtered.length?filtered.map(option=><button key={option.value} type="button" role="option" aria-selected={value===option.value} className="bounded-select-option" disabled={disabled} onClick={()=>{onChange(option.value);setOpen(false);setQuery('');trigger.current?.focus();}}>{option.label}</button>):<p className="bounded-select-empty">No matches found.</p>}
    </div>
  </div>,document.body):null;

  return <>
    <button ref={trigger} id={controlId??id} type="button" className="bounded-select-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-controls={open?`${id}-options`:undefined} aria-expanded={open} aria-required={required} aria-invalid={invalid||undefined} aria-describedby={describedBy} disabled={disabled} onKeyDown={event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setOpen(true);}}} onClick={()=>setOpen(state=>!state)}>
      <span className={selected?'':'bounded-select-placeholder'}>{selected?.label??placeholder}</span><span className="bounded-select-chevron" aria-hidden="true"><Chevron/></span>
    </button>
    {menu}
  </>;
}
