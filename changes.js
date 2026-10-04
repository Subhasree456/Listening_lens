/* ===========================================================================
   Listening Lens — changes.js   (LL.changes)

   Compares a recent window against the window before it and returns measurable
   differences only. Statistical observations, never psychological claims.
   Returns an explicit insufficient-data state when history is too short.

   Output:
     {available, reason, windowDays, current, previous, deltas, notes}
=========================================================================== */
LL.changes = (function(){
  const U=LL.util;

  const MIN_PREVIOUS_PLAYS=5;    // below this the baseline is not usable
  const MIN_DATED_SHARE=0.5;     // below this coverage the windows are unreliable

  function windowStats(records){
    const plays=records.length;
    const artistCount=new Map(), trackCount=new Map();
    const hours=new Array(24).fill(0), weekdays=new Array(7).fill(0);
    let ms=0, named=0;
    records.forEach(r=>{
      if(r.artist) artistCount.set(r.artist,(artistCount.get(r.artist)||0)+1);
      if(r.track){ trackCount.set(r.track+"\u0001"+r.artist,(trackCount.get(r.track+"\u0001"+r.artist)||0)+1); named++; }
      ms+=r.ms||0;
      if(r.ts){ hours[r.ts.getHours()]++; weekdays[(r.ts.getDay()+6)%7]++; }
    });
    return {
      plays,
      ms,
      hours,
      weekdays,
      uniqueArtists:artistCount.size,
      uniqueTracks:trackCount.size,
      repeatRate:plays&&named/plays>=0.5?U.clamp(U.round(100*(1-trackCount.size/plays),1),0,100):null,
      artistNames:new Set(artistCount.keys()),
      artists:U.topEntries(artistCount,5).map(([name,count])=>({name,count})),
      msPerPlay:plays?Math.round(ms/plays):null
    };
  }

  function delta(current,previous){
    if(current===null||previous===null) return null;
    const abs=U.round(current-previous,1);
    return {absolute:abs,percent:previous?U.round((current-previous)/previous*100,1):null,direction:abs>0?"up":abs<0?"down":"flat"};
  }

  /* Normalised L1 distance between two hourly distributions (0 = identical,
     1 = completely different) plus the hours that moved most. */
  function hourlyShift(current,previous){
    const sum=a=>a.reduce((s,v)=>s+v,0);
    const cs=sum(current), ps=sum(previous);
    if(!cs||!ps) return {distance:null,changedHours:[]};
    const parts=[];
    let distance=0;
    for(let h=0;h<24;h++){
      const a=current[h]/cs, b=previous[h]/ps;
      distance+=Math.abs(a-b);
      parts.push({hour:h,change:U.round((a-b)*100,1),current:current[h],previous:previous[h]});
    }
    parts.sort((x,y)=>Math.abs(y.change)-Math.abs(x.change));
    return {distance:U.round(distance/2,3),changedHours:parts.slice(0,3).filter(p=>Math.abs(p.change)>=5)};
  }

  /* Compares the last `windowDays` against the `windowDays` before it. */
  function compare(records,options){
    const opts=options||{};
    const windowDays=opts.windowDays||7;
    const now=opts.now instanceof Date?opts.now:new Date();
    const list=(Array.isArray(records)?records:[]).filter(r=>r&&r.ts instanceof Date);
    const base={available:false,reason:"",windowDays,current:null,previous:null,deltas:null,hourlyShift:null,newArtists:null,notes:[]};

    if(!list.length){
      return Object.assign(base,{reason:"This dataset has no timestamps, so periods cannot be compared."});
    }
    const coverage=list.length/(Array.isArray(records)&&records.length?records.length:1);
    if(coverage<MIN_DATED_SHARE){
      return Object.assign(base,{reason:`Only ${Math.round(coverage*100)}% of plays have timestamps — too few to compare periods reliably.`});
    }
    const end=now.getTime();
    const startCurrent=end-windowDays*U.MS_DAY;
    const startPrevious=end-2*windowDays*U.MS_DAY;
    const current=list.filter(r=>r.ts.getTime()>=startCurrent&&r.ts.getTime()<=end);
    const previous=list.filter(r=>r.ts.getTime()>=startPrevious&&r.ts.getTime()<startCurrent);

    if(!current.length){
      return Object.assign(base,{reason:`No plays fall inside the last ${windowDays} days, so there is nothing to compare.`});
    }
    if(previous.length<MIN_PREVIOUS_PLAYS){
      return Object.assign(base,{reason:`Not enough listening history before this period yet (${previous.length} of ${MIN_PREVIOUS_PLAYS} plays needed to build a baseline).`});
    }

    const cur=windowStats(current), prev=windowStats(previous);
    const newArtists=[...cur.artistNames].filter(n=>!prev.artistNames.has(n));
    const droppedArtists=[...prev.artistNames].filter(n=>!cur.artistNames.has(n));
    return {
      available:true,
      reason:"",
      windowDays,
      range:{currentFrom:new Date(startCurrent).toISOString(),currentTo:new Date(end).toISOString(),previousFrom:new Date(startPrevious).toISOString(),previousTo:new Date(startCurrent).toISOString()},
      current:cur,
      previous:prev,
      deltas:{
        plays:delta(cur.plays,prev.plays),
        listeningTime:delta(cur.ms,prev.ms),
        uniqueArtists:delta(cur.uniqueArtists,prev.uniqueArtists),
        uniqueTracks:delta(cur.uniqueTracks,prev.uniqueTracks),
        repeatRate:delta(cur.repeatRate,prev.repeatRate),
        msPerPlay:delta(cur.msPerPlay,prev.msPerPlay)
      },
      hourlyShift:hourlyShift(cur.hours,prev.hours),
      newArtists:{count:newArtists.length,names:newArtists.slice(0,5)},
      droppedArtists:{count:droppedArtists.length,names:droppedArtists.slice(0,5)},
      notes:[
        `Measured over the last ${windowDays} days against the ${windowDays} days before it.`,
        droppedArtists.length?`${droppedArtists.length} artist(s) from the earlier window did not appear in the recent one.`:""
      ].filter(Boolean)
    };
  }

  return {compare,windowStats,MIN_PREVIOUS_PLAYS,MIN_DATED_SHARE};
})();