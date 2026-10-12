import { useRef, type KeyboardEvent } from 'react';

export function AccountTabs<T extends string>({label,items,value,onChange,prefix,disabled=false}:{label:string;items:readonly {value:T;label:string}[];value:T;onChange:(value:T)=>void;prefix:string;disabled?:boolean}) {
  const refs=useRef<Array<HTMLButtonElement|null>>([]);
  function key(event:KeyboardEvent<HTMLButtonElement>,index:number) {
    let next=index;
    if(event.key==='ArrowRight') next=(index+1)%items.length;
    else if(event.key==='ArrowLeft') next=(index+items.length-1)%items.length;
    else if(event.key==='Home') next=0;
    else if(event.key==='End') next=items.length-1;
    else return;
    event.preventDefault(); onChange(items[next]!.value); refs.current[next]?.focus();
  }
  return <div className="account-workspace-tabs" role="tablist" aria-label={label}>{items.map((item,index)=><button ref={node=>{refs.current[index]=node;}} disabled={disabled} key={item.value} type="button" role="tab" id={`${prefix}-${item.value}-tab`} aria-controls={`${prefix}-panel`} aria-selected={value===item.value} tabIndex={value===item.value?0:-1} onClick={()=>onChange(item.value)} onKeyDown={event=>key(event,index)}>{item.label}</button>)}</div>;
}
