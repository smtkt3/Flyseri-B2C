import {describe, expect, it} from 'vitest';
import {buildDailySalesRequest, readDailySalesEvidence} from './sabre-sales-audit.contract.js';
const scope = {pcc:'BD01', airline:'BG', date:'2026-10-22', pnr:'ABC123'};
const transaction = (pnr='ABC123') => ({PnrLocator:pnr, DocumentType:'TKT', AirlineCode:'BG', PassengerName:'Private Name', Payments:{card:'private-card'}, DocumentDetails:{DocumentNumber:'9971234567890', TransactionCode:'SALE'}, TransactionDateTime:'2026-10-22T03:01:00'});
const response = (): any => ({Header:{Results:{Success:''}}, DSHeader:{PseudoCityCode:'BD01'}, '@_isQueryStillRunning':'false', DailySalesReport:{ReportDate:scope.date, Transaction:[transaction(), {...transaction('DEF456'), DocumentDetails:{DocumentNumber:'9970000000000'}}]}});
describe('read-only Sabre agency sales evidence', () => {
  it('builds schema-ordered scoped request without a mutation', () => {
    expect(buildDailySalesRequest(scope.pcc,scope.airline,scope.date)).toContain('<PseudoCityCode>BD01</PseudoCityCode><Airline><AirlineCode>BG</AirlineCode></Airline><ReportDate>2026-10-22</ReportDate><DocumentType>TKT</DocumentType>');
    expect(() => buildDailySalesRequest('<bad>','BG',scope.date)).toThrow();
    expect(() => buildDailySalesRequest('BD01','BG','2026-02-30')).toThrow();
  });
  it('keeps only matching ticket evidence and never customer names, payment data or other documents', () => {
    const evidence=readDailySalesEvidence(response(),scope);
    expect(evidence).toMatchObject({complete:true,automaticRetryAllowed:false,matchedDocuments:[{documentNumber:'9971234567890',transactionCode:'SALE'}]});
    expect(JSON.stringify(evidence)).not.toMatch(/Private|private|DEF456|9970000000000/);
  });
  it.each(['error','warning','running','chunks','pcc','date','unassociated','number'])('marks %s evidence incomplete', kind => {
    const raw=response();
    if(kind==='error') raw.Header.Results.Error={};
    if(kind==='warning') raw.Header.Results.Warning={};
    if(kind==='running') raw['@_isQueryStillRunning']='true';
    if(kind==='chunks') raw['@_maxChunks']='2';
    if(kind==='pcc') raw.DSHeader.PseudoCityCode='XX01';
    if(kind==='date') raw.DailySalesReport.ReportDate='2026-10-21';
    if(kind==='unassociated') delete raw.DailySalesReport.Transaction[1].PnrLocator;
    if(kind==='number') raw.DailySalesReport.Transaction[0].DocumentDetails.DocumentNumber='invalid';
    expect(readDailySalesEvidence(raw,scope).complete).toBe(false);
  });
  it('does not interpret missing or empty responses as proof of no ticket', () => {
    expect(readDailySalesEvidence(undefined,scope).complete).toBe(false);
    const raw=response();delete raw.DailySalesReport;
    expect(readDailySalesEvidence(raw,scope).complete).toBe(false);
  });
  it('can report no matching documents only within the confirmed date and scope', () => {
    const raw=response();raw.DailySalesReport.Transaction=[];
    expect(readDailySalesEvidence(raw,scope)).toMatchObject({complete:true,matchedDocuments:[],automaticRetryAllowed:false});
  });
  it('queries and verifies EMD records separately without accepting a flight-ticket row or unrelated passenger',()=>{
    expect(buildDailySalesRequest(scope.pcc,scope.airline,scope.date,'EMD')).toContain('<DocumentType>EMD</DocumentType>');
    const raw=response();raw.DailySalesReport.Transaction[0].DocumentType='EMD';
    const emdScope={...scope,documentType:'EMD' as const};
    expect(readDailySalesEvidence(raw,emdScope)).toMatchObject({complete:true,matchedDocuments:[{documentNumber:'9971234567890'}],automaticRetryAllowed:false});
    expect(JSON.stringify(readDailySalesEvidence(raw,emdScope))).not.toMatch(/Private|private|DEF456|9970000000000/);
    raw.DailySalesReport.Transaction[0].DocumentType='TKT';expect(readDailySalesEvidence(raw,emdScope).complete).toBe(false);
  });
});
