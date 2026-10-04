/* ===========================================================================
   Listening Lens — core.js
   Shared helpers (LL.util) and the normalised data model (LL.model).

   Layering:
     source payload → LL.normalize → LL.analytics → LL.changes / LL.insights
                    → LL.privacy    → app.js renderers

   Loaded as classic scripts so the dashboard still works when index.html is
   opened directly from disk (ES modules would require a web server).
=========================================================================== */
window.LL = window.LL || {};

/* ------------------------------- utilities ------------------------------- */
LL.util = (function(){
  /* Escapes any value that is interpolated into innerHTML. Imported history is
     untrusted input: a crafted artist/track name must never become live HTML. */
  function esc(v){
    return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
  function clamp(n,min,max){ return Math.min(max,Math.max(min,n)); }
  function firstNonEmpty(...vals){
    for(const v of vals){ if(v!==undefined&&v!==null&&String(v).trim()!=="") return String(v).trim(); }
    return "";
  }
  function firstPositiveNumber(...vals){
    for(const v of vals){ const n=Number(v); if(Number.isFinite(n)&&n>0) return n; }
    return 0;
  }
  /* Spotify uses ISO-8601 UTC ("2025-01-03T07:42:11Z") or a UTC
     "2025-01-03 07:42" form. Unparseable values return null rather than a bogus
     date, so undated history is reported as undated. */
  function parseTimestamp(v){
    if(v===undefined||v===null) return null;
    if(v instanceof Date) return Number.isNaN(v.getTime())?null:v;
    const s=String(v).trim();
    if(!s) return null;
    let iso=s.includes("T")?s:s.replace(" ","T");
    if(!/([zZ]|[+-]\d{2}:?\d{2})$/.test(iso)) iso+="Z";
    const d=new Date(iso);
    return Number.isNaN(d.getTime())?null:d;
  }
  /* 20 → "8:00 PM–9:00 PM" */
  function hourLabel(h){
    const ap=x=>x%12===0?12:x%12;
    const m=x=>x<12?"AM":"PM";
    const n=(h+1)%24;
    return `${ap(h)}:00 ${m(h)}–${ap(n)}:00 ${m(n)}`;
  }
  /* 20 → "8 PM" */
  function shortHour(h){
    const hour=((Number(h)%24)+24)%24;
    return `${hour%12===0?12:hour%12} ${hour<12?"AM":"PM"}`;
  }
  function fmtNumber(n){ return Number(n||0).toLocaleString(); }
  function fmtHours(ms){ return `${(Number(ms||0)/3600000).toFixed(1)}h`; }
  function fmtMinutes(ms){ return `${Math.round(Number(ms||0)/60000).toLocaleString()} min`; }
  function round(n,decimals=0){ const f=Math.pow(10,decimals); return Math.round(Number(n||0)*f)/f; }
  function topEntries(map,n){
    return [...map.entries()].sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0]))).slice(0,n);
  }
  /* Rounds a list so that it still sums to `total` (largest-remainder method). */
  function scaleToTotal(values,total){
    const sum=values.reduce((s,v)=>s+v,0);
    if(!sum) return values.map(()=>0);
    const exact=values.map(v=>v/sum*total);
    const out=exact.map(Math.floor);
    let rest=total-out.reduce((s,v)=>s+v,0);
    const order=exact.map((v,i)=>[v-Math.floor(v),i]).sort((a,b)=>b[0]-a[0]||a[1]-b[1]);
    for(let k=0;rest>0;k++,rest--) out[order[k%order.length][1]]++;
    return out;
  }
  const DAYS=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  const DAYS_FULL=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
  const BANDS=[["Night",0],["Morning",6],["Afternoon",12],["Evening",18]];
  const MS_MINUTE=60000, MS_HOUR=3600000, MS_DAY=86400000;

  return {esc,clamp,firstNonEmpty,firstPositiveNumber,parseTimestamp,hourLabel,shortHour,fmtNumber,fmtHours,fmtMinutes,round,topEntries,scaleToTotal,DAYS,DAYS_FULL,BANDS,MS_MINUTE,MS_HOUR,MS_DAY};
})();

/* ------------------------------ data model ------------------------------ */
LL.model = (function(){
  const U=LL.util;

  /* The single normalised listening record. Every source — demo data, imported
     JSON/CSV/Extended Streaming History and (Phase 3+) the Spotify Web API —
     must be converted into this shape before it reaches the analytics engine. */
  const RECORD_FIELDS=["artist","track","ms","ts"];

  /* Field types Spotify exports may contain that analytics does not need. They
     are detected so the user can be told they were discarded, and they are never
     copied into a record. */
  const SENSITIVE_KEYS=["ip_addr","ip","ipAddress","user_agent","userAgent","username","conn_country","platform","incognito_mode","offline_timestamp","device_type","device_id"];

  /* What each source can and cannot support. Metrics a source cannot support
     are reported as n/a with the reason taken from here. */
  const CAPABILITIES={
    demo:{
      label:"Demo dataset",
      completeHistory:true,
      dated:true,
      genres:true,
      repeats:true,
      note:"Synthetic sample history generated locally to demonstrate every panel. It is not a real account."
    },
    import:{
      label:"Imported Spotify history",
      completeHistory:true,
      dated:"only when the file includes timestamps",
      genres:false,
      repeats:true,
      note:"A Spotify export is a complete history, but exports contain no genre tags — genres require the Spotify Web API."
    },
    spotify_api:{
      label:"Spotify Web API",
      completeHistory:false,
      dated:true,
      genres:true,
      repeats:false,
      note:"The Web API returns a recent window (recently played) and affinity rankings (top items), not lifetime play counts, so totals are partial and repeat behaviour cannot be measured from it."
    }
  };

  function capabilities(kind){
    const base=CAPABILITIES[kind]||CAPABILITIES.import;
    return Object.assign({},base,{kind});
  }

  function isRecord(r){
    return !!(r&&typeof r==="object"&&typeof r.artist==="string"&&typeof r.track==="string"
      &&typeof r.ms==="number"&&(r.ts===null||r.ts instanceof Date));
  }

  /* Validates one record and reports every problem found (never throws). */
  function validate(record){
    const problems=[];
    if(!record||typeof record!=="object") return {ok:false,record:null,problems:["not an object"]};
    const artist=U.firstNonEmpty(record.artist);
    const track=U.firstNonEmpty(record.track);
    let ms=Number(record.ms);
    if(!Number.isFinite(ms)||ms<0){ problems.push("duration was not a usable number"); ms=0; }
    if(ms>6*U.MS_HOUR){ problems.push("duration exceeded 6 h and was clamped"); ms=6*U.MS_HOUR; }
    let ts=record.ts===undefined||record.ts===null?null:U.parseTimestamp(record.ts);
    if(ts===null&&record.ts!=null) problems.push("timestamp could not be parsed");
    if(!artist&&!track) return {ok:false,record:null,problems:problems.concat("no artist or track name")};
    return {ok:true,record:{artist,track,ms,ts},problems};
  }

  return {RECORD_FIELDS,SENSITIVE_KEYS,CAPABILITIES,capabilities,isRecord,validate};
})();