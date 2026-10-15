/** Customer messages describe an outcome or next step, never service internals. */
export function customerErrorMessage(code:string,message:string,status?:number):string {
  const standard:Record<string,string>={
    AUTHENTICATION_REQUIRED:'Please sign in to continue.',
    UNAUTHORIZED:'Please sign in to continue.',
    INVALID_SESSION:'Your session has expired. Please sign in again.',
    RATE_LIMITED:'Please wait a moment before trying again.',
    INTERNAL_ERROR:'We couldn’t complete this request. Please try again shortly.',
    INVALID_RESPONSE:'We couldn’t load this information. Please try again shortly.',
    NETWORK_ERROR:'We couldn’t connect. Please check your internet connection.',
    TIMEOUT:'This is taking longer than expected. Check the latest status before trying again.',
    ABORTED:'This request was cancelled.',
  };
  if(standard[code])return standard[code];
  if(/\b(?:sabre|supabase|redis|postgres(?:ql)?|backend|database|infrastructure|endpoint|payload|webhook|credentials?|configuration|configured|PCC|CERT|PKCE|OAuth|SDK)\b|\bAPI\b|https?:\/\/|\b(?:provider|supplier)\b/i.test(message)){
    if(code==='OFFER_EXPIRED')return 'This fare is no longer available. Please choose a flight again.';
    if(code==='VALIDATION_ERROR')return 'Please check your details and try again.';
    if(code==='CONFLICT')return 'This request needs a review. Please check its latest status or contact Flyseri.';
    if(code==='FORBIDDEN')return 'This action is unavailable. Please contact Flyseri for help.';
    if(code==='NOT_FOUND')return 'We couldn’t find this information. Please contact Flyseri if you need help.';
    return 'This service is temporarily unavailable. Please try again shortly.';
  }
  if(status!==undefined&&status>=500)return 'This service is temporarily unavailable. Please try again shortly.';
  return message;
}
