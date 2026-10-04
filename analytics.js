/* ===========================================================================
   Listening Lens — analytics.js   (LL.analytics)

   The single analytics engine. Demo data, imported history and (Phase 3+) the
   Spotify Web API all arrive here as normalised records, so there is exactly
   one implementation of every metric — no per-source analytics code.

     analyze(source) → engine result

   Rules:
     • every metric is computed from the records actually available;
     • a metric that the data cannot support returns {available:false, reason}
       and the renderer shows "n/a" with that reason;
     • nothing is fabricated, and no output is a psychological claim.
=========================================================================== */
LL.analytics = (function(){
  const U=LL.util, M=LL.model;

  /* Availability thresholds — a metric is withheld below these. */
  const MIN_DATED_PLAYS=5;      // dated plays needed for hourly analysis
  const MIN_DATED_SHARE=0.5;    // share of plays that must be dated
  const MIN_ACTIVE_DAYS=3;      // active days needed for consistency
  const MIN_TRACK_SHARE=0.5;    // share of plays that must carry a track name

  /* Accepts a source payload or a bare array of records (defensive). */
  function normalizeSource(input){
    if(Array.isArray(input)) return {kind:"import",label:"Imported data",records:input,genres:null,rankings:null,coverage:{},note:""};
    const src=input||{};
    return {
      kind:src.kind||"import",
      label:src.label||"Imported data",
      records:(Array.isArray(src.records)?src.records:[]).filter(M.isRecord),
      genres:src.genres||null,
      rankings:src.rankings||null,
      coverage:src.coverage||{},
      note:src.note||"",
      now:src.now instanceof Date?src.now:undefined
    };
  }

  /* ------------------------------- volume ------------------------------- */
  /* Local calendar day (YYYY-MM-DD) so day counts line up with the local-time
     hour and weekday analysis. */
  function localDayKey(d){
    const pad=n=>String(n).padStart(2,"0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }
  function buildVolume(records){
    const plays=records.length;
    let totalMs=0, dated=0, named=0, firstTs=null, lastTs=null;
    const perDay=new Map();
    records.forEach(r=>{
      totalMs+=r.ms||0;
      if(r.track) named++;
      if(r.ts instanceof Date){
        dated++;
        if(!firstTs||r.ts<firstTs) firstTs=r.ts;
        if(!lastTs||r.ts>lastTs) lastTs=r.ts;
        /* Local date key, so it matches the local-time hour/weekday analysis. */
        const key=localDayKey(r.ts);
        perDay.set(key,(perDay.get(key)||0)+1);
      }
    });
    const datedShare=plays?dated/plays:0;
    return {
      plays,
      totalMs,
      minutes:totalMs/U.MS_MINUTE,
      hours:totalMs/U.MS_HOUR,
      hoursText:U.fmtHours(totalMs),
      minutesText:U.fmtMinutes(totalMs),
      averageMsPerPlay:plays?Math.round(totalMs/plays):null,
      datedPlays:dated,
      undatedPlays:plays-dated,
      datedShare:U.round(datedShare*100,1),
      namedPlays:named,
      firstTs,
      lastTs,
      rangeText:firstTs?`${firstTs.toISOString().slice(0,10)} → ${lastTs.toISOString().slice(0,10)}`:"",
      uniqueDays:perDay.size,
      perDay
    };
  }

  /* ------------------------------- artists ------------------------------- */
  function buildArtists(records,plays){
    const counts=new Map();
    records.forEach(r=>{ if(r.artist) counts.set(r.artist,(counts.get(r.artist)||0)+1); });
    const unique=counts.size;
    if(!unique){
      return {available:false,reason:"No artist names were found in this data.",unique:0,total:plays,top:[],loyalty:null,oneOffArtists:0,oneOffPlays:0};
    }
    const top=U.topEntries(counts,5).map(([name,count])=>[name,count]);
    const oneOffArtists=topEntries(counts).filter(([,c])=>c===1);
    const oneOffPlays=oneOffArtists.length;
    const lead=top[0];
    return {
      available:true,
      reason:"",
      unique,
      total:plays,
      top,
      oneOffArtists:oneOffArtists.length,
      oneOffPlays,
      loyalty:{
        available:true,
        topArtist:lead[0],
        topArtistPlays:lead[1],
        topArtistShare:plays?U.round(lead[1]/plays*100,1):null,
        oneOffArtists:oneOffArtists.length,
        /* Share of plays from artists you played more than once. */
        returningShare:plays?U.round((plays-oneOffPlays)/plays*100,1):null
      },
      distribution:counts
    };
  }
  /* Local helper: full sorted list (U.topEntries needs an explicit n). */
  function topEntries(map){ return U.topEntries(map,map.size); }
/* -------------------------------- tracks -------------------------------- */
  function buildTracks(records,plays,volume){
    const counts=new Map();
    records.forEach(r=>{
      if(!r.track) return;
      const key=`${r.track}\u0001${r.artist||"Unknown artist"}`;
      counts.set(key,(counts.get(key)||0)+1);
    });
    const unique=counts.size;
    const namedShare=plays?volume.namedPlays/plays:0;
    const top=U.topEntries(counts,5).map(([key,count])=>{
      const parts=key.split("\u0001");
      return [parts[0],parts[1],count];
    });
    if(!unique){
      return {available:false,reason:"No track names were found in this data.",unique:0,top:[],repeatRate:null,repeatPlays:0,namedShare:0};
    }
    return {
      available:true,
      reason:"",
      unique,
      top,
      namedShare:U.round(namedShare*100,1),
      repeatPlays:plays-unique,
      repeatRate:U.round((1-unique/plays)*100,1)
    };
  }

  /* -------------------------------- genres --------------------------------
     Genres can only be reported when a source supplies them. Imports never do
     (Spotify exports carry no genre tags); the Spotify Web API does, per artist.
     An artist with several genres contributes to several buckets, so shares can
     add up to more than 100% for such sources. */
  function buildGenres(genresPayload,records,plays){
    const base={
      available:false,reason:"",source:null,distribution:[],distinct:0,
      taggedPlays:0,taggedShare:0,mayExceed100:false
    };
    if(!genresPayload||!genresPayload.artistToGenres){
      return Object.assign(base,{
        reason:"Genre information is not included in listening-history exports. It comes from the Spotify Web API (top artists)."
      });
    }
    const map=genresPayload.artistToGenres;
    const counts=new Map();
    let tagged=0;
    records.forEach(r=>{
      const list=map[r.artist];
      if(!list||!list.length) return;
      tagged++;
      list.forEach(g=>counts.set(g,(counts.get(g)||0)+1));
    });
    if(!tagged||!counts.size){
      return Object.assign(base,{reason:"No genre tags were found for the artists in this data."});
    }
    const distribution=[...counts.entries()]
      .map(([name,c])=>({name,plays:c,share:plays?U.round(c/plays*100,1):0}))
      .sort((a,b)=>b.plays-a.plays||a.name.localeCompare(b.name));
    return {
      available:true,
      reason:"",
      source:genresPayload.source||"source",
      distribution,
      distinct:distribution.length,
      taggedPlays:tagged,
      taggedShare:plays?U.round(tagged/plays*100,1):0,
      mayExceed100:distribution.reduce((s,d)=>s+d.share,0)>101
    };
  }

  /* --------------------------------- hours -------------------------------- */
  function buildHours(records,volume){
    const histogram=new Array(24).fill(0);
    if(volume.datedPlays>=MIN_DATED_PLAYS&&volume.datedShare/100>=MIN_DATED_SHARE){
      records.forEach(r=>{ if(r.ts instanceof Date) histogram[r.ts.getHours()]++; });
      const total=histogram.reduce((s,v)=>s+v,0);
      const peak=histogram.indexOf(Math.max(...histogram));
      const ranked=histogram.map((plays,hour)=>({hour,plays})).sort((a,b)=>b.plays-a.plays||a.hour-b.hour);
      const bands=U.BANDS.map(([name,start])=>{
        let plays=0;
        for(let h=start;h<start+6;h++) plays+=histogram[h];
        return {name,start,plays,share:total?U.round(plays/total*100,1):0};
      });
      return {
        available:true,
        reason:"",
        histogram,
        total,
        peakHour:{hour:peak,plays:histogram[peak],share:total?U.round(histogram[peak]/total*100,1):0,label:U.hourLabel(peak)},
        topHours:ranked.slice(0,3).map(x=>Object.assign({label:U.hourLabel(x.hour)},x)),
        bands,
        window:"all dated plays"
      };
    }
    return {
      available:false,
      histogram,
      total:0,
      peakHour:null,
      topHours:[],
      bands:[],
      window:"",
      reason:volume.datedPlays
        ? `Too few dated plays to chart hours reliably (${volume.datedPlays} of ${volume.plays} plays have timestamps).`
        : "This dataset has no usable timestamps, so hours cannot be charted."
    };
  }
/* --------------------------------- days --------------------------------- */
  function buildDays(records,volume){
    const histogram=new Array(7).fill(0);
    if(volume.datedPlays>=MIN_DATED_PLAYS&&volume.datedShare/100>=MIN_DATED_SHARE){
      records.forEach(r=>{ if(r.ts instanceof Date) histogram[(r.ts.getDay()+6)%7]++; });
      const total=histogram.reduce((s,v)=>s+v,0);
      const best=histogram.indexOf(Math.max(...histogram));
      const activeDays=volume.uniqueDays;
      let consistency=null, consistencyReason="";
      if(activeDays>=MIN_ACTIVE_DAYS){
        const vals=[...volume.perDay.values()];
        const mean=vals.reduce((s,v)=>s+v,0)/vals.length;
        const sd=Math.sqrt(vals.reduce((s,v)=>s+(v-mean)*(v-mean),0)/vals.length);
        consistency=mean>0?U.clamp(Math.round(100*(1-sd/mean)),0,100):null;
      } else {
        consistencyReason=`Not enough days with listening to measure consistency (${activeDays} active day(s), ${MIN_ACTIVE_DAYS} needed).`;
      }
      return {
        available:true,
        reason:"",
        consistencyReason,
        histogram,
        total,
        activeDays,
        mostActiveDay:{index:best,name:U.DAYS_FULL[best],short:U.DAYS[best],plays:histogram[best],share:total?U.round(histogram[best]/total*100,1):0},
        consistency
      };
    }
    return {
      available:false,
      histogram,
      total:0,
      activeDays:volume.uniqueDays,
      mostActiveDay:null,
      consistency:null,
      consistencyReason:"Consistency needs dated listening history.",
      reason:volume.datedPlays
        ? `Too few dated plays to chart weekdays reliably (${volume.datedPlays} of ${volume.plays} plays have timestamps).`
        : "This dataset has no usable timestamps, so weekdays cannot be charted."
    };
  }

  /* ------------------------------- repeats -------------------------------- */
  function buildRepeats(tracks,volume){
    const namedShare=volume.plays?volume.namedPlays/volume.plays:0;
    if(!tracks.unique||namedShare<MIN_TRACK_SHARE){
      return {
        available:false,
        reason:tracks.unique
          ? `Too few plays carry a track name to measure repeats (${U.round(namedShare*100,1)}% of plays).`
          : "No track names were found in this data, so repeat behaviour cannot be measured.",
        trackRepeatRate:null,
        repeatPlays:0,
        uniqueTracks:tracks.unique,
        namedShare:U.round(namedShare*100,1)
      };
    }
    return {
      available:true,
      reason:"",
      trackRepeatRate:tracks.repeatRate,
      repeatPlays:tracks.repeatPlays,
      uniqueTracks:tracks.unique,
      namedShare:U.round(namedShare*100,1)
    };
  }

  /* ------------------------------ discovery ------------------------------- */
  function buildDiscovery(artists,plays){
    if(!artists.available){
      return {available:false,reason:"No artist data is available in this source.",rate:null,oneOffPlays:0,oneOffArtists:0};
    }
    return {
      available:true,
      reason:"",
      rate:plays?U.round(artists.oneOffPlays/plays*100,1):0,
      oneOffPlays:artists.oneOffPlays,
      oneOffArtists:artists.oneOffArtists,
      detail:"Plays by artists that appear exactly once in this dataset."
    };
  }

  /* --------------------------- rolling windows ---------------------------- */
  function buildWindows(records,now){
    const make=days=>{
      const cutoff=now.getTime()-days*U.MS_DAY;
      const list=records.filter(r=>r.ts instanceof Date&&r.ts.getTime()>=cutoff);
      const counts=new Map();
      let ms=0;
      list.forEach(r=>{ if(r.artist) counts.set(r.artist,(counts.get(r.artist)||0)+1); ms+=r.ms||0; });
      return {days,plays:list.length,ms,artists:counts.size,records:list,topArtist:U.topEntries(counts,1)[0]?{name:U.topEntries(counts,1)[0][0],plays:U.topEntries(counts,1)[0][1]}:null};
    };
    const all={days:null,plays:records.length,ms:records.reduce((s,r)=>s+(r.ms||0),0),artists:null,records};
    const out={all};
    [7,30,183].forEach(d=>{ out[d]=make(d); });
    out.all.artists=out[183].artists;
    return out;
  }
/* ------------------------- music DNA + signals --------------------------
     Normalised entropy of the genre distribution: 0 = a single genre,
     100 = plays spread evenly across the distinct genres available. */
  function genreDiversityScore(genres){
    if(!genres.available||genres.distinct<2) return null;
    const total=genres.distribution.reduce((s,d)=>s+d.plays,0);
    if(!total) return null;
    const h=-genres.distribution.reduce((s,d)=>{
      const p=d.plays/total;
      return s+(p>0?p*Math.log(p):0);
    },0);
    return U.clamp(Math.round(h/Math.log(genres.distinct)*100),0,100);
  }

  /* Every score is null when the data cannot support it, and each row carries
     the measurement behind it so the renderer can explain the number. */
  function buildDna(parts){
    const diversity=genreDiversityScore(parts.genres);
    return [
      {
        label:"Discovery",
        value:parts.discovery.available?Math.round(parts.discovery.rate):null,
        basis:"Share of plays by artists you played exactly once."
      },
      {
        label:"Diversity",
        value:diversity,
        basis:diversity===null
          ? (parts.genres.available?"Needs at least two distinct genres to compare.":"Needs artist genre data, which comes from the Spotify Web API.")
          : "How evenly plays are spread across the genres available (normalised entropy)."
      },
      {
        label:"Replay",
        value:parts.repeats.available?Math.round(parts.repeats.trackRepeatRate):null,
        basis:parts.repeats.available?"Share of plays that repeat a track already played.":parts.repeats.reason
      },
      {
        label:"Consistency",
        value:parts.days.consistency,
        basis:parts.days.consistency===null
          ? parts.days.consistencyReason
          : "Plays per active day: 100 = the same number of plays each day."
      }
    ];
  }

  function trendOf(value){
    if(value===null) return null;
    return value>=70?"high":value>=40?"moderate":"low";
  }

  function buildSignals(parts){
    const diversity=genreDiversityScore(parts.genres);
    const replay=parts.repeats.available?Math.round(parts.repeats.trackRepeatRate):null;
    const discovery=parts.discovery.available?Math.round(parts.discovery.rate):null;
    return [
      {
        label:"Replay tendency",
        score:replay,
        available:replay!==null,
        text:replay===null
          ? parts.repeats.reason
          : replay>=70?"You frequently return to a small set of tracks."
          : replay>=40?"Your listening mixes repeats with tracks you had not played before."
          : "Most plays are tracks you had not played before.",
        basis:replay===null?parts.repeats.reason:`Repeats = ${U.fmtNumber(parts.repeats.repeatPlays)} of ${U.fmtNumber(parts.volume.plays)} plays.`
      },
      {
        label:"Genre diversity",
        score:diversity,
        available:diversity!==null,
        text:diversity===null
          ? parts.genres.reason
          : diversity>=70?"Your plays are spread fairly evenly across the genres available."
          : "Your listening concentrates in a few of the available genres.",
        basis:diversity===null?parts.genres.reason:`Normalised entropy across ${parts.genres.distinct} genre(s).`
      },
      {
        label:"Discovery behaviour",
        score:discovery,
        available:discovery!==null,
        text:discovery===null
          ? parts.discovery.reason
          : discovery>=60?"A large share of plays come from artists you played only once."
          : discovery>=25?"Some listening comes from single-play artists; most comes from artists you return to."
          : "Almost all listening comes from artists you return to.",
        basis:discovery===null?parts.discovery.reason:`Single-play artists: ${U.fmtNumber(parts.discovery.oneOffPlays)} of ${U.fmtNumber(parts.volume.plays)} plays.`
      },
      {
        label:"Time consistency",
        score:parts.days.consistency,
        available:parts.days.consistency!==null,
        text:parts.days.consistency===null
          ? parts.days.consistencyReason
          : parts.days.consistency>=60?"Your daily listening volume is fairly steady."
          : parts.days.consistency>=30?"Your daily listening volume varies from day to day."
          : "Your listening is concentrated in a few heavier days.",
        basis:parts.days.consistency===null
          ? parts.days.consistencyReason
          : `Variation in plays per day across ${parts.days.activeDays} active day(s).`
      }
    ].map(s=>Object.assign(s,{trend:trendOf(s.score)}));
  }
/* ------------------------------- heat matrix ----------------------------
     7 weekdays × 24 hours, built from the same dated plays as hours/days. */
  function buildHeat(records,volume){
    const datedOk=volume.datedPlays>=MIN_DATED_PLAYS&&volume.datedShare/100>=MIN_DATED_SHARE;
    const matrix=Array.from({length:7},()=>new Array(24).fill(0));
    if(!datedOk){
      return {
        available:false,reason:volume.datedPlays
          ? `Too few dated plays to build a weekday/hour map (${volume.datedPlays} of ${volume.plays} plays have timestamps).`
          : "This dataset has no usable timestamps, so a weekday/hour map cannot be built.",
        matrix:null,max:0,peak:null,dayNames:U.DAYS
      };
    }
    records.forEach(r=>{ if(r.ts instanceof Date) matrix[(r.ts.getDay()+6)%7][r.ts.getHours()]++; });
    let max=0,peak=null;
    matrix.forEach((row,d)=>row.forEach((plays,h)=>{ if(plays>max){ max=plays; peak={dayIndex:d,dayName:U.DAYS[d],hour:h,plays,label:U.hourLabel(h)}; } }));
    return {available:true,reason:"",matrix,max,peak,dayNames:U.DAYS,total:volume.datedPlays};
  }

  /* ------------------------------ prediction ------------------------------
     Frequency-based estimates only: play counts, repeat behaviour and
     time-of-day patterns. There is no trained model, and every figure states
     the measurement it came from. */
  function buildPrediction(parts){
    const volume=parts.volume, artists=parts.artists, hours=parts.hours;
    const discovery=parts.discovery, repeats=parts.repeats, genres=parts.genres;
    const recent=parts.windows[30];
    const topArtist=artists.available?artists.top[0]:null;
    const useRecent=hours.available&&recent&&recent.plays>=2&&recent.topArtist;
    const lead=useRecent
      ? {name:recent.topArtist.name,plays:recent.topArtist.plays,scope:"last 30 days"}
      : topArtist
        ? {name:topArtist[0],plays:topArtist[1],scope:"this dataset"}
        : null;
    const leadShare=lead&&volume.plays?U.round(lead.plays/volume.plays*100,1):null;

    return {
      method:"frequency",
      methodText:genres.available
        ? "Frequency-based estimate from play counts, repeat behaviour and time-of-day patterns in the available data. No trained model is used."
        : "Frequency-based estimate from play counts, repeat behaviour and time-of-day patterns. Artist genres are not part of listening-history exports, so no genre estimate is shown.",
      chips:["Play counts","Repeat behaviour"]
        .concat(hours.available?["Time-of-day"]:[])
        .concat(genres.available?["Genres"]:[])
        .concat(discovery.available?["Discovery"]:[]),
      hero:{
        available:!!lead,
        value:lead?`${leadShare}%`:null,
        label:lead?`share of plays by ${lead.name}`:"No artist data available"
      },
      genre:{
        available:genres.available,
        value:genres.available?genres.distribution[0].name:null,
        detail:genres.available
          ? `${genres.distribution[0].name} is ${genres.distribution[0].share}% of tagged plays (${genres.source}).`
          : genres.reason
      },
      boxes:{
        artist:{
          available:!!lead,
          value:lead?lead.name:"Not available",
          score:lead?`${U.fmtNumber(lead.plays)} plays`:"n/a",
          note:lead?`most plays in the ${lead.scope}`:"no artist data in this source"
        },
        hour:{
          available:hours.available,
          value:hours.available?hours.peakHour.label:"Not available",
          score:hours.available?`${U.fmtNumber(hours.peakHour.plays)} plays`:"n/a",
          note:hours.available?"peak hour · device local time":hours.reason
        },
        discovery:{
          available:discovery.available,
          value:discovery.available?`${discovery.rate}%`:"Not available",
          score:discovery.available?`${U.fmtNumber(discovery.oneOffPlays)} single-play artist plays`:"n/a",
          note:discovery.available?"plays from artists you played exactly once":discovery.reason
        }
      },
      repeat:{
        available:repeats.available,
        value:repeats.available?`${Math.round(repeats.trackRepeatRate)}/100`:null,
        detail:repeats.available?"repeat tendency from track play counts":repeats.reason
      }
    };
  }

  /* ------------------------------ entry point ------------------------------ */
  function analyze(input){
    const source=normalizeSource(input);
    const now=source.now instanceof Date?source.now:new Date();
    const records=source.records;
    const volume=buildVolume(records);
    const artists=buildArtists(records,volume.plays);
    const tracks=buildTracks(records,volume.plays,volume);
    const genres=buildGenres(source.genres,records,volume.plays);
    const hours=buildHours(records,volume);
    const days=buildDays(records,volume);
    const repeats=buildRepeats(tracks,volume);
    const discovery=buildDiscovery(artists,volume.plays);
    const windows=buildWindows(records,now);
    const heat=buildHeat(records,volume);
    const prediction=buildPrediction({volume,artists,hours,discovery,repeats,genres,windows});

    return {
      source:{
        kind:source.kind,
        label:source.label,
        capabilities:M.capabilities(source.kind),
        coverage:source.coverage,
        note:source.note,
        rankings:source.rankings
      },
      generatedAt:now.toISOString(),
      volume,
      artists,
      tracks,
      genres,
      hours,
      days,
      repeats,
      discovery,
      windows,
      heat,
      prediction,
      dna:buildDna({discovery,genres,repeats,days}),
      signals:buildSignals({repeats,discovery,days,genres,volume}),
      /* Filled in by the app orchestrator, so each module stays independent. */
      comparison:null,
      insights:[]
    };
  }

  return {analyze,buildWindows,buildHeat,genreDiversityScore,buildPrediction,MIN_DATED_PLAYS,MIN_DATED_SHARE,MIN_ACTIVE_DAYS,MIN_TRACK_SHARE};
})();