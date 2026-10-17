import type { FlightBooking, OrderDetail, OrderReceipt } from '@flyseri/types';
import logoUrl from '../assets/flyseri-logo.png';

export async function createPaymentReceiptPdf(receipt: OrderReceipt, order: OrderDetail, booking: FlightBooking | null) {
  const { jsPDF } = await import('jspdf');
  if (receipt.documentKind !== 'PAYMENT_RECEIPT' || receipt.orderNumber !== order.orderNumber ||
      !Number.isFinite(Date.parse(receipt.paidAt)) || !Number.isFinite(Number(receipt.totalAmount)) || Number(receipt.totalAmount) < 0) {
    throw new Error('Receipt details could not be verified. Please try again.');
  }
  const logoResponse = await fetch(logoUrl);
  if (!logoResponse.ok) throw new Error('Receipt branding could not be loaded. Please try again.');
  const logo = new Uint8Array(await logoResponse.arrayBuffer());
  const doc = new jsPDF({unit:'pt',format:'a4',compress:true});
  const width = 595.28, height = 841.89, left = 44, right = width - left;
  const ink = '#193854', muted = '#526B85', blue = '#1763C6', line = '#DCE7F2';
  let y = 0;
  const test = order.payment?.provider === 'STRIPE_TEST';
  const money = (amount:string, currency=receipt.currency) => `${currency} ${new Intl.NumberFormat('en',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(amount))}`;
  const text = (value:string, x:number, top:number, size=10, color=ink, bold=false, align:'left'|'right'='left') => {
    const clean = value.replace(/[\r\n\t]+/g,' ').replace(/[\u0000-\u001f]/g,'').replace(/[–—]/g,'-');
    doc.setFont('helvetica',bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(color);
    // Browser font shaping preserves international names instead of dropping unsupported glyphs.
    if (/[^\x20-\x7e]/.test(clean)) {
      const canvas=document.createElement('canvas'), context=canvas.getContext('2d');
      if (!context) throw new Error('Your browser could not prepare this receipt.');
      const font=`${bold ? '700' : '400'} ${size*3}px Arial, sans-serif`;
      context.font=font; canvas.width=Math.ceil(context.measureText(clean).width)+6; canvas.height=Math.ceil(size*4.5);
      context.font=font; context.fillStyle=color; context.textBaseline='alphabetic'; context.fillText(clean,3,size*3.2);
      const w=canvas.width/3;
      doc.addImage(canvas.toDataURL('image/png'),'PNG',align==='right' ? x-w : x,top-size*1.07,w,canvas.height/3);
    } else doc.text(clean,x,top,{align});
  };
  const wrap = (value:string, maxWidth:number, size=10) => {
    const canvas=document.createElement('canvas'), context=canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not prepare this receipt.');
    context.font=`${size}px Arial, sans-serif`;
    const lines:string[]=[]; let current='';
    for (const char of value.replace(/[\r\n\t]+/g,' ')) {
      if (current && context.measureText(current+char).width>maxWidth) { lines.push(current.trimEnd()); current=''; }
      current+=char;
    }
    if(current) lines.push(current.trimEnd());
    return lines.length ? lines : [''];
  };
  const rule = (top:number) => {doc.setDrawColor(line);doc.setLineWidth(.6);doc.line(left,top,right,top);};
  const header = () => {
    // The approved 447px square asset has generous transparent padding around the wordmark.
    const scale=116/420;
    doc.saveGraphicsState();doc.rect(left,36,116,35,null).clip().discardPath();
    doc.addImage(logo,'PNG',left-13*scale,36-160*scale,447*scale,447*scale);
    doc.restoreGraphicsState();
    text('Travel with more wonder',left,85,8,muted);
    text('PAYMENT RECEIPT',right,50,15,ink,true,'right');
    text('Paid',right,69,10,'#087765',true,'right');
    rule(94); y=119;
    if(test){doc.setFillColor('#EFF5FF');doc.roundedRect(left,y-12,right-left,30,5,5,'F');text('TEST PAYMENT - No real money collected. Not valid for travel.',left+12,y+6,9,blue,true);y+=43;}
  };
  const ensure = (space:number) => {if(y+space>height-100){doc.addPage();header();}};
  const paragraph = (value:string,maxWidth=right-left,size=10,color=muted,bold=false,x=left) => {
    for(const row of wrap(value,maxWidth,size)){ensure(size+7);text(row,x,y,size,color,bold);y+=size+6;}
  };
  const heading = (value:string) => {ensure(44);y+=13;text(value,left,y,12,ink,true);y+=23;};
  header();
  text('Receipt / order number',left,y,9,muted);
  text('Payment date (UTC)',left+290,y,9,muted);y+=18;
  text(receipt.orderNumber,left,y,10,ink,true);
  text(new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(new Date(receipt.paidAt)),left+290,y,10,ink,true);y+=26;
  text('Payment status',left,y,9,muted);text('Currency',left+290,y,9,muted);y+=17;
  text('Payment received',left,y,10,'#087765',true);text(receipt.currency,left+290,y,10,ink,true);y+=25;
  if(booking){
    heading('Booking details');
    if(booking.pnr) paragraph(`Booking reference (PNR): ${booking.pnr}`,right-left,10,ink,true);
    paragraph(`Travelers: ${booking.passengerNames.join(', ')}`);
    const legs=booking.selectedOffer.multiCityLegs ?? [booking.selectedOffer.outbound,...(booking.selectedOffer.inbound ? [booking.selectedOffer.inbound] : [])];
    for(const leg of legs) for(const segment of leg.segments) paragraph(`${segment.origin} to ${segment.destination} | ${segment.marketingCarrier} ${segment.flightNumber} | ${segment.departureAt.slice(0,10)} ${segment.departureAt.slice(11,16)} (departure airport local time)`);
  }
  heading('Payment breakdown');
  const tableHeader=()=>{ensure(32);doc.setFillColor('#F1F5FA');doc.rect(left,y-14,right-left,29,'F');text('Description',left+10,y+4,9,muted,true);text('Qty',right-137,y+4,9,muted,true,'right');text('Amount',right-10,y+4,9,muted,true,'right');y+=33;};
  tableHeader();
  for(const item of receipt.items){
    const rows=wrap(item.description,285,10);
    if(y+Math.min(rows.length,3)*16+14>height-100){doc.addPage();header();tableHeader();}
    text(String(item.quantity),right-137,y,10,ink,false,'right');
    text(money(item.totalAmount,item.currency),right-10,y,10,ink,true,'right');
    for(const row of rows){if(y+22>height-100){doc.addPage();header();tableHeader();}text(row,left+10,y,10);y+=16;}
    y+=9;rule(y);y+=21;
  }
  ensure(138);
  if(Number(receipt.discountAmount)>0){text('Discounts applied',left+10,y,10,muted);text(`-${money(receipt.discountAmount!)}`,right-10,y,10,ink,false,'right');y+=28;}
  doc.setFillColor('#EDF5FF');doc.roundedRect(left,y-8,right-left,55,6,6,'F');
  text('TOTAL PAID',left+14,y+24,11,blue,true);text(money(receipt.totalAmount),right-14,y+24,18,blue,true,'right');y+=77;
  paragraph('This receipt confirms payment for the items listed above. It is not an airline ticket or a tax invoice.',right-left,9);
  paragraph('A booking reference alone does not confirm ticket issuance. Check My bookings for your ticket documents before traveling.',right-left,9);
  doc.setProperties({title:`Flyseri payment receipt ${receipt.orderNumber}`,subject:'Verified payment receipt',author:'Flyseri',creator:'Flyseri'});
  const pages=doc.getNumberOfPages();
  for(let page=1;page<=pages;page++){doc.setPage(page);rule(height-64);text('Flyseri | Payment receipt',left,height-44,8,muted);text(`${page} / ${pages}`,right,height-44,8,muted,false,'right');}
  return {blob:doc.output('blob'),filename:`Flyseri-payment-receipt-${receipt.orderNumber.replace(/[^A-Za-z0-9-]/g,'')}.pdf`};
}
