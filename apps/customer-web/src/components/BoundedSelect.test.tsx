// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BoundedSelect } from './BoundedSelect';
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
function Selection(){const [value,setValue]=useState('B');return <BoundedSelect ariaLabel="Cabin" value={value} options={['A','B','C'].map(value=>({value,label:value}))} placeholder="Choose" onChange={setValue}/>;}
it('supports arrow navigation, selection and Escape without losing trigger focus',()=>{
 render(<Selection/>);const trigger=screen.getByRole('button',{name:'Cabin'});
 fireEvent.keyDown(trigger,{key:'ArrowDown'});
 expect(document.activeElement).toBe(screen.getByRole('option',{name:'B'}));
 fireEvent.keyDown(document.activeElement!,{key:'End'});
 expect(document.activeElement).toBe(screen.getByRole('option',{name:'C'}));
 fireEvent.click(document.activeElement!);
 expect(trigger.textContent).toContain('C');expect(document.activeElement).toBe(trigger);
 fireEvent.keyDown(trigger,{key:'ArrowDown'});
 fireEvent.keyDown(document.activeElement!,{key:'Escape'});
 expect(screen.queryByRole('listbox')).toBeNull();expect(document.activeElement).toBe(trigger);
});
it('keeps the menu inside the visible area when a keyboard shrinks the viewport',()=>{
 const viewport=Object.assign(new EventTarget(),{height:250,width:320,offsetTop:100,offsetLeft:0});
 vi.stubGlobal('visualViewport',viewport);
 render(<Selection/>);const trigger=screen.getByRole('button',{name:'Cabin'});
 vi.spyOn(trigger,'getBoundingClientRect').mockReturnValue({top:500,bottom:548,left:10,right:260,width:250,height:48,x:10,y:500,toJSON:()=>({})});
 fireEvent.click(trigger);
 const menu=document.querySelector<HTMLElement>('.bounded-select-menu')!;
 expect(Number.parseFloat(menu.style.top)).toBeGreaterThanOrEqual(108);
 expect(Number.parseFloat(menu.style.top)+Number.parseFloat(menu.style.maxHeight)).toBeLessThanOrEqual(342);
});
