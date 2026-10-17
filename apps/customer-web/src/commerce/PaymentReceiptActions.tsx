import { useEffect, useRef, useState } from 'react';
import type { FlightBooking, OrderDetail } from '@flyseri/types';
import { commerceService } from '../services/commerceService';
import './payment-receipt.css';

export function PaymentReceiptActions({order,booking=null}: {order:OrderDetail;booking?:FlightBooking|null}) {
  const [pdf,setPdf]=useState<{url:string;filename:string}|null>(null);
  const [busy,setBusy]=useState(false), [open,setOpen]=useState(false), [error,setError]=useState('');
  const [previewZoom,setPreviewZoom]=useState(75);
  const modal=useRef<HTMLDialogElement>(null), running=useRef(false), active=useRef(true);
  const url=useRef<string|null>(null);
  useEffect(()=>{active.current=true;return()=>{active.current=false;if(url.current)URL.revokeObjectURL(url.current);};},[]);
  useEffect(()=>{const dialog=modal.current;if(!dialog)return;if(open&&!dialog.open)dialog.showModal();else if(!open&&dialog.open)dialog.close();},[open]);
  useEffect(()=>{const resize=()=>setPreviewZoom(Math.min(75,Math.max(20,Math.floor((window.innerWidth-32)/7.94))));resize();window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);
  const download=(value:{url:string;filename:string})=>{const link=document.createElement('a');link.href=value.url;link.download=value.filename;document.body.append(link);link.click();link.remove();};
  async function prepare(mode:'view'|'download') {
    if(running.current)return;
    if(pdf){if(mode==='view')setOpen(true);else download(pdf);return;}
    running.current=true;setBusy(true);setError('');
    try {
      const receipt=await commerceService.receipt(order.id);
      const {createPaymentReceiptPdf}=await import('./paymentReceiptPdf');
      const result=await createPaymentReceiptPdf(receipt,order,booking);
      if(!active.current)return;
      const value={url:URL.createObjectURL(result.blob),filename:result.filename};url.current=value.url;setPdf(value);
      if(mode==='view')setOpen(true);else download(value);
    } catch {if(active.current)setError('We couldn’t prepare your PDF receipt. Please try again.');}
    finally{running.current=false;if(active.current)setBusy(false);}
  }
  return <div className="payment-receipt-actions">
    <div className="payment-receipt-buttons"><button type="button" className="account-outline-button" disabled={busy} onClick={()=>void prepare('view')}>{busy ? 'Preparing PDF…' : 'View payment receipt'}</button><button type="button" className="account-outline-button" disabled={busy} onClick={()=>void prepare('download')}>Download receipt</button></div>
    <small>PDF document · payment receipt</small>{error && <p role="alert">{error}</p>}
    <dialog ref={modal} className="payment-receipt-dialog" aria-labelledby="payment-receipt-title" onCancel={()=>setOpen(false)} onClose={()=>setOpen(false)}>
      <header><div><h2 id="payment-receipt-title">Payment receipt</h2><p>Flyseri · PDF document</p></div><button type="button" className="account-outline-button" onClick={()=>setOpen(false)} aria-label="Close payment receipt">Close</button></header>
      {pdf && open && <><iframe key={previewZoom} title="Flyseri payment receipt PDF" src={`${pdf.url}#zoom=${previewZoom}&navpanes=0&pagemode=none`}/><footer><p>If the PDF preview isn’t supported on your device, download it to view.</p><a href={pdf.url} download={pdf.filename} className="btn-primary">Download PDF</a></footer></>}
    </dialog>
  </div>;
}
