/** Consistent disclosure indicator, independent of the current text font. */
export function Chevron({up = false}: {up?:boolean}) {
  return <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" width="12" height="12" style={{width:12,height:12,display:'inline-block',verticalAlign:'middle',flexShrink:0,fill:'none',stroke:'currentColor',strokeWidth:1.6,strokeLinecap:'round',strokeLinejoin:'round'}}><path d={up ? 'M4 10l4-4 4 4' : 'M4 6l4 4 4-4'}/></svg>;
}
