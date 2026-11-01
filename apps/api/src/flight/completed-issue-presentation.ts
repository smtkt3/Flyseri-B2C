/** Resolve current status labels without rewriting immutable historical evidence. */
export function completedIssuePresentation<T extends {kind:string;status:string;result:unknown}>(record:T):T{
 if(record.kind!=='ISSUE'||record.status!=='COMPLETED'||!record.result||typeof record.result!=='object'||Array.isArray(record.result))return record;
 const original=record.result as Record<string,unknown>;
 const diagnostic=original.ticketingDiagnostic as Record<string,unknown>|undefined;
 if(diagnostic&&diagnostic.ticketCheck!=='VERIFIED')return record;
 const {preSubmissionDiagnostic,...current}=original;
 return {...record,result:{...current,ticketIssued:true,
  ...(preSubmissionDiagnostic?{previousPreSubmissionDiagnostic:preSubmissionDiagnostic}:{}),
  ...(diagnostic?{initialTicketingDiagnostic:original.initialTicketingDiagnostic??diagnostic,ticketingDiagnostic:{...diagnostic,classification:'DOCUMENTS_VERIFIED',reason:'DOCUMENTS_VERIFIED',errors:[],warnings:[],reconciliationReasons:[],recommendedNextAction:'DOCUMENTS_VERIFIED'}}:{})}};
}
