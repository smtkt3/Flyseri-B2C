/** Read-only DailySalesSummary 1.2.2 contract. Never use this evidence to clear an issuance lock automatically. */
type Node = Record<string, any>;
const list = (value: any): Node[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const value = (node: any): string | undefined => typeof node === 'string' ? node : typeof node?.['#text'] === 'string' ? node['#text'] : undefined;
const valid = (node: unknown, pattern: RegExp) => { const text = value(node); return text !== undefined && pattern.test(text) ? text : undefined; };

export function buildDailySalesRequest(pcc: string, airline: string, date: string,documentType:'TKT'|'EMD'='TKT'): string {
  if (!/^[A-Z0-9]{4}$/.test(pcc) || !/^[A-Z0-9]{2}$/.test(airline) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date).toISOString().slice(0, 10) !== date) throw Error('Invalid sales audit scope');
  if(!['TKT','EMD'].includes(documentType))throw Error('Unsupported sales document scope');
  return `<DailySalesSummaryRQ version="1.2.2" xmlns="http://www.sabre.com/ns/Ticketing/AsrServices/1.0"><Header/><SelectionCriteria><PseudoCityCode>${pcc}</PseudoCityCode><Airline><AirlineCode>${airline}</AirlineCode></Airline><ReportDate>${date}</ReportDate><DocumentType>${documentType}</DocumentType></SelectionCriteria></DailySalesSummaryRQ>`;
}

/** Filters other passengers in memory. Output contains only the explicitly selected PNR. */
export function readDailySalesEvidence(raw: Node | undefined, scope: {pcc: string; airline: string; date: string; pnr: string;documentType?:'TKT'|'EMD'}) {
  const documentType=scope.documentType??'TKT';buildDailySalesRequest(scope.pcc, scope.airline, scope.date,documentType);
  if (!/^[A-Z0-9]{6}$/.test(scope.pnr)) throw Error('Invalid sales audit PNR');
  const reasons = new Set<string>();
  const results = raw?.Header?.Results;
  if (!results || !Object.hasOwn(results, 'Success') || Object.hasOwn(results, 'Error') || Object.hasOwn(results, 'Warning')) reasons.add('SUPPLIER_SUCCESS_NOT_ESTABLISHED');
  if (value(raw?.DSHeader?.PseudoCityCode) !== scope.pcc) reasons.add('PCC_NOT_CONFIRMED');
  if (raw?.['@_isQueryStillRunning'] !== 'false' && raw?.['@_isQueryStillRunning'] !== false) reasons.add('REPORT_COMPLETION_NOT_CONFIRMED');
  if (raw?.['@_maxChunks'] !== undefined && String(raw['@_maxChunks']) !== '1' || raw?.['@_chunkNumber'] !== undefined && String(raw['@_chunkNumber']) !== '1') reasons.add('REPORT_CHUNKS_INCOMPLETE');
  const reports = list(raw?.DailySalesReport);
  if (reports.length !== 1 || value(reports[0]?.ReportDate) !== scope.date) reasons.add('REPORT_DATE_NOT_CONFIRMED');
  const matchedDocuments: {documentNumber: string; status?: string; transactionCode?: string; transactionDateTime?: string}[] = [];
  let unassociatedTransactions = 0;
  for (const report of reports) for (const transaction of list(report?.Transaction)) {
    const pnr = valid(transaction?.PnrLocator, /^[A-Z0-9]{6}$/);
    if (!pnr) { unassociatedTransactions++; continue; }
    if (pnr !== scope.pnr) continue;
    if (value(transaction?.DocumentType) !== documentType || value(transaction?.AirlineCode) !== scope.airline) reasons.add('MATCHED_DOCUMENT_SCOPE_UNCONFIRMED');
    const documentNumber = valid(transaction.DocumentDetails?.DocumentNumber, /^\d{13}$/);
    if (!documentNumber) { reasons.add('MATCHED_DOCUMENT_NUMBER_MISSING'); continue; }
    matchedDocuments.push({documentNumber, status: valid(transaction.DocumentDetails?.DocumentStatusCode, /^[A-Z]$/), transactionCode: valid(transaction.DocumentDetails?.TransactionCode, /^(SALE|RFND|CNCL)$/), transactionDateTime: valid(transaction.TransactionDateTime, /^\d{4}-\d{2}-\d{2}T[\d:.+Z-]+$/)});
  }
  if (unassociatedTransactions) reasons.add('TRANSACTIONS_WITHOUT_PNR');
  return {...scope, complete: reasons.size === 0, reasons: [...reasons], unassociatedTransactions, matchedDocuments, automaticRetryAllowed: false as const};
}
