import type { GuideDocument } from './visa-guide-content';
import logoUrl from '../assets/flyseri-logo.png';

/** The guide checklist contains no customer identity or passport details. */
export async function createVisaChecklistPdf(input:{title:string;profession:string;documents:GuideDocument[];source:string;additionalSources?:string[]}) {
  const {jsPDF}=await import('jspdf');
  const logoResponse=await fetch(logoUrl);
  if(!logoResponse.ok) throw new Error('Branding unavailable');
  const logo=new Uint8Array(await logoResponse.arrayBuffer());
  const pdf=new jsPDF({unit:'pt',format:'a4',compress:true});
  const left=44,right=551,width=507;
  let y=0;
  const clean=(text:string)=>text.replace(/[–—]/g,'-').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/×/g,'x').replace(/·/g,'/');
  const write=(text:string,x:number,at:number,size=10,bold=false,color='#193854')=>{pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);pdf.setTextColor(color);pdf.text(clean(text),x,at);};
  function header() {
    const scale=116/420;
    pdf.saveGraphicsState();pdf.rect(left,30,116,36,null).clip().discardPath();
    pdf.addImage(logo,'PNG',left-13*scale,30-160*scale,447*scale,447*scale);pdf.restoreGraphicsState();
    write('VISA DOCUMENT CHECKLIST',302,48,12,true);write('For Bangladeshi nationals only',302,66,9,false,'#526b85');
    pdf.setDrawColor('#dce7f2');pdf.line(left,83,right,83);y=109;
  }
  const ensure=(height:number)=>{if(y+height>760){pdf.addPage();header();}};
  function paragraph(text:string,size=10,bold=false,color='#526b85',indent=0) {
    pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);
    const lines=pdf.splitTextToSize(clean(text),width-indent) as string[];
    for(const line of lines){ensure(size+6);write(line,left+indent,y,size,bold,color);y+=size+5;}
  }
  header();paragraph(input.title,18,true,'#193854');y+=6;paragraph('Applicant profession: '+input.profession,10,true);y+=14;
  paragraph('Use this guide to prepare your documents. The final checklist depends on your visa category and applicant circumstances. Confirm current requirements before applying.',9,false);y+=16;
  input.documents.forEach((item,index)=>{
    ensure(65);paragraph(`${index+1}. ${item.title}`,11,true,'#193854');
    if(item.condition) paragraph(item.condition,9,false,'#1767cc',14);
    for(const text of item.paragraphs) paragraph(text,10,false,'#526b85',14);
    y+=13;
  });
  ensure(85);y+=6;paragraph('Official guidance',10,true,'#193854');paragraph(input.source,8,false,'#1767cc');input.additionalSources?.forEach(source=>paragraph(source,8,false,'#1767cc'));paragraph('Visa approval and entry decisions belong to the relevant authorities. This checklist is not a visa, approval or guarantee of entry.',9);
  const count=pdf.getNumberOfPages();
  for(let page=1;page<=count;page++){pdf.setPage(page);pdf.setDrawColor('#dce7f2');pdf.line(left,785,right,785);write('Flyseri / Visa assistance',left,804,8,false,'#526b85');write(`Page ${page} of ${count}`,right-60,804,8,false,'#526b85');}
  pdf.setProperties({title:input.title+' - document checklist',author:'Flyseri',subject:'Visa preparation checklist for Bangladeshi nationals'});
  return pdf;
}
