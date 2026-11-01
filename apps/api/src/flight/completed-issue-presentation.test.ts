import {describe,it,expect} from 'vitest';
import {completedIssuePresentation} from './completed-issue-presentation.js';
describe('completed issuance presentation',()=>{
 const source=()=>({kind:'ISSUE',status:'COMPLETED',result:{stage:'COMPLETED',preSubmissionDiagnostic:{classification:'NOT_SUBMITTED'},ticketingDiagnostic:{ticketCheck:'VERIFIED',classification:'DOCUMENT_RECONCILIATION_REQUIRED',reason:'DOCUMENT_EVIDENCE_NOT_VERIFIED',errors:[{providerCodes:['0316']}],warnings:[{type:'UNABLE_TO_RETRIEVE_TICKETS'}],dispatch:{requestSha256:'a'.repeat(64)}}}});
 it('separates historical diagnostics from the verified current result without mutating evidence',()=>{
  const record=source(),before=JSON.stringify(record),shown=completedIssuePresentation(record);
  expect(shown.result).toMatchObject({ticketIssued:true,previousPreSubmissionDiagnostic:{classification:'NOT_SUBMITTED'},initialTicketingDiagnostic:record.result.ticketingDiagnostic,ticketingDiagnostic:{classification:'DOCUMENTS_VERIFIED',reason:'DOCUMENTS_VERIFIED',errors:[],warnings:[],dispatch:record.result.ticketingDiagnostic.dispatch}});
  expect(shown.result).not.toHaveProperty('preSubmissionDiagnostic');expect(JSON.stringify(record)).toBe(before);
  expect(completedIssuePresentation(shown)).toEqual(shown);
 });
 it.each(['OUTCOME_UNKNOWN','EXECUTING','FAILED'])('does not hide an unresolved %s result',status=>{
  const record={...source(),status};expect(completedIssuePresentation(record)).toBe(record);
 });
 it('does not hide mismatched evidence or rewrite cancellation/refund completion',()=>{
  const record=source();record.result.ticketingDiagnostic.ticketCheck='DOCUMENTS_INCOMPLETE';expect(completedIssuePresentation(record)).toBe(record);
  const refund={...source(),kind:'REFUND'};expect(completedIssuePresentation(refund)).toBe(refund);
 });
});
