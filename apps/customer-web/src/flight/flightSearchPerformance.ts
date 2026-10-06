export function flightSearchPerformance(){
  const start=performance.now();let firstResultMs:number|null=null;
  const measure=(name:string,end:number,detail:object)=>{
    try{performance.clearMeasures(name);performance.measure(name,{start,end,detail});}catch{/* Timing must never interfere with shopping. */}
  };
  return {
    arrived(offerCount:number){if(firstResultMs===null&&offerCount>0){const end=performance.now();firstResultMs=end-start;measure('flyseri.flight.first-result',end,{offerCount});}},
    finished(offerCount:number,complete:boolean){
      const end=performance.now();const detail={firstResultMs,totalMs:end-start,offerCount,complete};
      measure('flyseri.flight.search-complete',end,detail);
      window.dispatchEvent(new CustomEvent('flyseri:flight-search-timing',{detail}));
    },
  };
}
