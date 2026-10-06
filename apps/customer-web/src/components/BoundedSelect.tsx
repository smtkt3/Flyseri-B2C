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
  required?: boolean;
  disabled?: boolean;
}

export function BoundedSelect({value,options,placeholder,onChange,searchable=false,searchPlaceholder='Search…',ariaLabel,required=false,disabled=false}:BoundedSelectProps) {
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
      const gutter=8,gap=5,maxHeight=Math.min(260,window.innerHeight-gutter*2);
      const below=window.innerHeight-rect.bottom-gap-gutter,above=rect.top-gap-gutter;
      const flip=below<Math.min(210,maxHeight)&&above>below;
      const height=Math.max(100,Math.min(maxHeight,flip?above:below));
      const width=Math.min(rect.width,window.innerWidth-gutter*2);
      setPosition({top:flip?Math.max(gutter,rect.top-gap-height):Math.min(window.innerHeight-gutter-height,rect.bottom+gap),left:Math.max(gutter,Math.min(rect.left,window.innerWidth-gutter-width)),width,maxHeight:height});
    };
    place();
    window.addEventListener('resize',place);
    window.addEventListener('scroll',place,true);
    return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[open]);

  useEffect(()=>{
    if(!open)return;
    if(searchable)search.current?.focus();
    const closeOutside=(event:PointerEvent)=>{
      const target=event.target as Node;
      if(!trigger.current?.contains(target)&&!panel.current?.contains(target))setOpen(false);
    };
    const closeEscape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);trigger.current?.focus();}};
    document.addEventListener('pointerdown',closeOutside);
    document.addEventListener('keydown',closeEscape);
    return()=>{document.removeEventListener('pointerdown',closeOutside);document.removeEventListener('keydown',closeEscape);};
  },[open,searchable]);

  const menu=open?createPortal(<div ref={panel} className="bounded-select-menu" style={position}>
    {searchable&&<input ref={search} className="bounded-select-search" type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} />}
      <div role="listbox" aria-label={ariaLabel??placeholder} aria-required={required}>
      {filtered.length?filtered.map(option=><button key={option.value} type="button" role="option" aria-selected={value===option.value} className="bounded-select-option" disabled={disabled} onClick={()=>{onChange(option.value);setOpen(false);setQuery('');trigger.current?.focus();}}>{option.label}</button>):<p className="bounded-select-empty">No matches found.</p>}
    </div>
  </div>,document.body):null;

  return <>
    <button ref={trigger} id={id} type="button" className="bounded-select-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-required={required} disabled={disabled} onClick={()=>setOpen(state=>!state)}>
      <span className={selected?'':'bounded-select-placeholder'}>{selected?.label??placeholder}</span><span className="bounded-select-chevron" aria-hidden="true">⌄</span>
    </button>
    {menu}
  </>;
}
