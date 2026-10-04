/* ===========================================================================
   Listening Lens — normalize.js   (LL.normalize)

   Converts every supported source into normalised listening records:
     • imported JSON / CSV / Extended Streaming History   (recordsFromRows)
     • demo dataset                                       (demoSource)
     • Spotify Web API payload                            (fromSpotifyApi, Phase 3)

   Sources are handed to LL.analytics as a *source payload*:
     {kind, label, records, genres, rankings, note, capabilities, coverage}
=========================================================================== */
LL.normalize = (function(){
  const U=LL.util, M=LL.model;

  const MAX_FILE_BYTES=40*1024*1024;

  /* RFC 4180-style reader: quoted fields, commas inside quotes, escaped double
     quotes (""), BOM and CRLF/LF/CR line endings. A naive split(",") corrupts
     every export containing a quoted name such as "Tyler, The Creator". */
  function parseCSV(text){
    const src=String(text).replace(/^\uFEFF/,"");
    const rows=[]; let row=[], cell="", quoted=false;
    for(let i=0;i<src.length;i++){
      const ch=src[i];
      if(quoted){
        if(ch==='"'){
          if(src[i+1]==='"'){ cell+='"'; i++; }   // escaped quote
          else quoted=false;
        } else cell+=ch;                          // commas/newlines inside quotes
        continue;
      }
      if(ch==='"') quoted=true;
      else if(ch===","){ row.push(cell); cell=""; }
      else if(ch==="\n"){ row.push(cell); rows.push(row); row=[]; cell=""; }
      else if(ch==="\r"){ row.push(cell); rows.push(row); row=[]; cell=""; if(src[i+1]==="\n") i++; }
      else cell+=ch;
    }
    if(cell!==""||row.length){ row.push(cell); rows.push(row); }

    const clean=rows.filter(r=>r.some(v=>String(v).trim()!==""));
    if(clean.length<2) return [];
    const headers=clean[0].map(h=>String(h).trim());
    return clean.slice(1).map(cells=>{
      const o={};
      headers.forEach((h,i)=>{ if(h) o[h]=String(cells[i]??"").trim(); });
      return o;
    });
  }

  function parseJSONExport(text){
    try{ return JSON.parse(text); }catch(e){ throw new Error("json"); }
  }

  /* Reports which sensitive field types a file contains, so the user can be
     told what was discarded. Only the field *names* are ever surfaced. */
  function detectSensitiveKeys(rows){
    const found=new Set();
    rows.slice(0,200).forEach(r=>{
      if(r&&typeof r==="object"&&!Array.isArray(r)){
        Object.keys(r).forEach(k=>{ if(M.SENSITIVE_KEYS.includes(k)) found.add(k); });
      }
    });
    return [...found].sort();
  }

  /* Maps one raw export row to a normalised record. Only artist, track, duration
     and timestamp survive; IP address, user agent, country, platform and every
     other field are dropped here and never stored. */
  function recordFrom(row){
    if(!row||typeof row!=="object"||Array.isArray(row)) return null;
    return {
      artist:U.firstNonEmpty(row.master_metadata_album_artist_name,row.artistName,row.artist_name,row.artist),
      track:U.firstNonEmpty(row.master_metadata_track_name,row.trackName,row.track_name,row.track),
      ms:U.firstPositiveNumber(row.ms_played,row.msPlayed,row.ms_played_ms,row.duration_ms),
      ts:U.parseTimestamp(U.firstNonEmpty(row.ts,row.endTime,row.end_time,row.timestamp))
    };
  }

  /* rows → {records, coverage}. Validation is centralised in LL.model.validate,
     so every source is held to the same rules. */
  function recordsFromRows(rows){
    const records=[], problems=[], rejectedSamples=[];
    let rejected=0;
    (Array.isArray(rows)?rows:[]).forEach(row=>{
      const candidate=recordFrom(row);
      const result=M.validate(candidate);
      if(result.ok) records.push(result.record);
      else{
        rejected++;
        if(rejectedSamples.length<3) rejectedSamples.push(String(row&&(row.track||row.trackName||row.master_metadata_track_name)||JSON.stringify(row)).slice(0,40));
      }
      if(result.problems.length) problems.push(...result.problems);
      else if(!result.ok) problems.push("missing artist and track name");
    });
    return {
      records,
      rejected,
      rejectedSamples,
      problems,
      droppedFields:detectSensitiveKeys(Array.isArray(rows)?rows:[])
    };
  }

  /* Reads a File object and returns a source payload for LL.analytics. */
  async function recordsFromFile(file){
    if(file.size>MAX_FILE_BYTES) throw new Error("large");
    const text=await file.text();
    const isJson=String(file.name||"").toLowerCase().endsWith(".json");
    const rows=isJson?parseJSONExport(text):parseCSV(text);
    if(!Array.isArray(rows)) throw new Error("shape");
    if(!rows.length) throw new Error("empty");
    const result=recordsFromRows(rows);
    if(!result.records.length) throw new Error("norows");
    return {result, isJson, fileName:String(file.name||"import")};
  }
/* ---------------------------- demo data source ----------------------------
     The demo dataset is generated as *normalised records*, not as hardcoded
     chart values. Its aggregates reproduce the prototype's published numbers
     (1,248 plays, 83.4 h, 184 artists, the same top-5 artists, the same genre
     split, the same weekly and hourly shapes), so demo mode exercises exactly
     the same analytics engine that real data uses.

     Two published demo figures are intentionally NOT reproduced because no
     record set can satisfy them: the original "Discovery 82" and
     "Diversity 67" were not derived from any data. Those panels now show the
     values the fixture actually supports. */
  const DEMO_TARGETS={
    plays:1248,
    totalMinutes:5004,                     // 83.4 h
    uniqueArtists:184,
    weekdays:[58,72,48,85,66,96,77],       // Mon..Sun shape
    hours:[8,12,18,11,9,14,20,32,48,61,54,38,28,23,31,44,67,81,92,74,56,39,25,16],
    genres:[["Alternative Pop",300],["Indie",237],["Pop",225],["R&B",175],["Rock",137],["Other",174]],
    artistGenres:{
      "The Weeknd":"R&B","Taylor Swift":"Pop","Arctic Monkeys":"Indie",
      "Billie Eilish":"Alternative Pop","Tame Impala":"Alternative Pop",
      "The Neighbourhood":"Indie","Harry Styles":"Pop"
    },
    /* Pinned artists: the published top-artist totals, with the published top
       track counts. Each artist's remaining plays are spread over small extra
       tracks (at most 9 plays each, below the smallest published top-track
       count) so both the top-artist and top-track rankings are preserved. */
    artistTotals:{
      "The Weeknd":142,"Taylor Swift":118,"Arctic Monkeys":96,"Billie Eilish":87,
      "Tame Impala":72,"The Neighbourhood":21,"Harry Styles":18
    },
    trackPlan:[
      ["The Weeknd",[["Blinding Lights",31]]],
      ["Taylor Swift",[["Cruel Summer",27]]],
      ["Arctic Monkeys",[["505",24]]],
      ["Billie Eilish",[]],
      ["Tame Impala",[]],
      ["The Neighbourhood",[["Sweater Weather",21]]],
      ["Harry Styles",[["As It Was",18]]]
    ],
    /* Extra tracks carry at most this many plays — below the smallest published
       top-track count (18) — so they never displace the published top tracks. */
    trackChunk:17,
    fillerPrefixes:["Neon","Glass","Paper","Silver","Hollow","Coastal","Lunar","Velvet","Amber","Quiet","Wild","Solar","Crimson","Marble","Fable"],
    fillerSuffixes:["Waves","Tigers","Static","Youth","Harbor","Machines","Parade","Garden","Rivers","Echo","Motel","Kites"],
    fillerTracks:["Echoes","Nightfall","Slow Motion","Golden Hour","Paper Planes","Static Bloom","Afterglow","Coastline","Velvet Noise","Midnight Run"]
  };

  /* Splits a play quota into per-artist counts of at most 4 plays, so a genre's
     total is hit exactly without inflating the artist count. */
  function splitQuota(quota){
    const counts=[];
    let left=quota;
    while(left>0){ const take=Math.min(4,left); counts.push(take); left-=take; }
    return counts;
  }

  /* Builds the filler artists needed to complete each genre quota: 172 artists
     with 4 plays, one with 2 and four with 1 — 694 plays in total across the six
     genre buckets that the pinned artists do not already fill. */
  function buildFillerArtists(remainingByGenre){
    const artists=[];
    let nameIndex=0;
    DEMO_TARGETS.genres.forEach(([genre])=>{
      const quota=remainingByGenre[genre];
      if(quota<=0) return;
      splitQuota(quota).forEach(count=>{
        const space=DEMO_TARGETS.fillerPrefixes.length*DEMO_TARGETS.fillerSuffixes.length;
        const prefix=DEMO_TARGETS.fillerPrefixes[nameIndex%DEMO_TARGETS.fillerPrefixes.length];
        const suffix=DEMO_TARGETS.fillerSuffixes[Math.floor(nameIndex/DEMO_TARGETS.fillerPrefixes.length)%DEMO_TARGETS.fillerSuffixes.length];
        const cycles=Math.floor(nameIndex/space);
        const name=`${prefix} ${suffix}${cycles?" II":""}`;
        nameIndex++;
        const tracks=count>=2
          ?[[DEMO_TARGETS.fillerTracks[nameIndex%DEMO_TARGETS.fillerTracks.length],Math.ceil(count/2)],
            [DEMO_TARGETS.fillerTracks[(nameIndex+7)%DEMO_TARGETS.fillerTracks.length],Math.floor(count/2)]]
          :[[DEMO_TARGETS.fillerTracks[nameIndex%DEMO_TARGETS.fillerTracks.length],count]];
        artists.push({name,genre,tracks});
      });
    });
    return artists;
  }
  /* Builds the demo source payload: normalised records + the artist→genre map
     that the engine aggregates (exactly how Spotify API genres arrive later). */
  function demoSource(now){
    const T=DEMO_TARGETS;
    const anchor=now instanceof Date?now:new Date();
    const todayStart=new Date(anchor.getFullYear(),anchor.getMonth(),anchor.getDate());

    /* 1. Named artists from the pinned track plan. Each artist's remaining plays
          are spread over small extra tracks so the published top-track ranking
          (largest 31 plays) is preserved while the artist total is exact. */
    const artistPlays=new Map();
    const trackPlays=[];
    T.trackPlan.forEach(([artist,tracks])=>{
      const total=T.artistTotals[artist]||0;
      let pinned=0;
      tracks.forEach(([track,count])=>{
        trackPlays.push([artist,track,count]);
        pinned+=count;
      });
      artistPlays.set(artist,total);
      let left=total-pinned, extra=0;
      while(left>0){
        const take=Math.min(T.trackChunk,left);
        trackPlays.push([artist,`${T.fillerTracks[extra%T.fillerTracks.length]} ${extra+1}`,take]);
        left-=take; extra++;
      }
    });

    /* 2. Filler artists cover the rest of each genre quota. */
    const remaining={};
    T.genres.forEach(([genre,total])=>remaining[genre]=total);
    artistPlays.forEach((count,artist)=>{
      const genre=T.artistGenres[artist]||"Other";
      remaining[genre]=(remaining[genre]||0)-count;
    });
    const filler=buildFillerArtists(remaining);
    filler.forEach(a=>{
      artistPlays.set(a.name,a.tracks.reduce((s,t)=>s+t[1],0));
      a.tracks.forEach(([track,count])=>trackPlays.push([a.name,track,count]));
    });

    /* 3. Expand every artist+track play count into one record per play. */
    const slots=[];
    const genreOf=artist=>T.artistGenres[artist]||(filler.find(f=>f.name===artist)||{}).genre||"Other";
    trackPlays.forEach(([artist,track,count])=>{
      for(let i=0;i<count;i++) slots.push({artist,track,genre:genreOf(artist)});
    });

    /* 4. Dates: the last seven local days, so every weekday appears once and the
          weekly and hourly shapes are reproduced exactly. */
    const dateForWeekday=new Array(7).fill(null);
    for(let back=6;back>=0;back--){
      const d=new Date(todayStart.getTime()-back*U.MS_DAY);
      dateForWeekday[(d.getDay()+6)%7]=d;
    }
    const weekdays=U.scaleToTotal(T.weekdays,T.plays);
    const hours=U.scaleToTotal(T.hours,T.plays);
    const weekdaySlots=[], hourSlots=[];
    weekdays.forEach((n,w)=>{ for(let i=0;i<n;i++) weekdaySlots.push(w); });
    hours.forEach((n,h)=>{ for(let i=0;i<n;i++) hourSlots.push(h); });

    /* 5. Durations: uniform-ish, tuned so the total is exactly 5,004 minutes. */
    const totalMs=T.totalMinutes*U.MS_MINUTE;
    const base=Math.floor(totalMs/T.plays);
    const spare=totalMs-base*T.plays;

    const records=slots.map((slot,i)=>{
      const day=dateForWeekday[weekdaySlots[i]];
      const hour=hourSlots[(i*37)%hourSlots.length];   // 37 is coprime with 1,248 → a permutation
      const ts=new Date(day.getFullYear(),day.getMonth(),day.getDate(),hour,(i*13)%60,(i*29)%60);
      return {artist:slot.artist,track:slot.track,ms:base+(i<spare?1:0),ts};
    });

    const artistToGenres={};
    artistPlays.forEach((_c,artist)=>{ artistToGenres[artist]=[genreOf(artist)]; });

    return {
      kind:"demo",
      label:"Demo dataset",
      records,
      genres:{source:"demo fixture",artistToGenres},
      rankings:null,
      coverage:{file:null,rows:T.plays,records:records.length,rejected:0,dated:records.length,droppedFields:[],sample:true},
      note:"Synthetic sample history generated in the browser. No account, no network calls."
    };
  }
/* Builds an import source payload from a file read. */
  function importSource(fileResult){
    const result=fileResult.result;
    return {
      kind:"import",
      label:"Imported Spotify history",
      records:result.records,
      genres:null,                 // exports contain no genre tags
      rankings:null,
      coverage:{
        file:fileResult.fileName,
        rows:result.records.length+result.rejected,
        records:result.records.length,
        rejected:result.rejected,
        rejectedSamples:result.rejectedSamples,
        dated:result.records.filter(r=>r.ts).length,
        droppedFields:result.droppedFields,
        problems:result.problems.slice(0,5)
      },
      note:"Local file analysis. Records are held in memory only and are never uploaded."
    };
  }

  /* ---------------------- Spotify Web API adapter (Phase 3) -----------------
     Design only — Phase 2 performs no network calls. This adapter converts a
     Spotify Web API payload into the same normalised records the engine already
     consumes, so Phase 3 only has to fetch the payload and hand it over.

     Expected payload:
       { profile:{display_name},
         recentlyPlayed:{items:[{track:{name,artists:[{name}],duration_ms},played_at}]},
         topArtists:{items:[{name,genres}]},
         topTracks:{items:[{name,artists}]} }

     `omitted` lists what the Web API cannot support, so the UI can show n/a
     with a reason instead of inventing values. */
  function fromSpotifyApi(payload){
    const p=payload||{};
    const records=[];
    const items=(p.recentlyPlayed&&p.recentlyPlayed.items)||[];
    items.forEach(item=>{
      const track=item&&item.track;
      if(!track||!track.name) return;                 // episodes / unavailable items skipped
      records.push({
        artist:U.firstNonEmpty((track.artists||[]).map(a=>a&&a.name).filter(Boolean).join(", ")),
        track:U.firstNonEmpty(track.name),
        ms:U.firstPositiveNumber(track.duration_ms),  // the API exposes track length, not played length
        ts:U.parseTimestamp(item.played_at)
      });
    });
    const artistToGenres={};
    const topArtists=(p.topArtists&&p.topArtists.items)||[];
    topArtists.forEach(a=>{ if(a&&a.name) artistToGenres[a.name]=(a.genres||[]).filter(Boolean); });

    return {
      source:{
        kind:"spotify_api",
        label:(p.profile&&p.profile.display_name)?`Spotify · ${p.profile.display_name}`:"Spotify account",
        records,
        genres:Object.keys(artistToGenres).length?{source:"Spotify Web API top artists",artistToGenres}:null,
        rankings:{
          artists:topArtists.map(a=>({name:a.name,genres:(a.genres||[]).filter(Boolean)})),
          tracks:((p.topTracks&&p.topTracks.items)||[]).map(t=>({name:t.name,artist:(t.artists||[]).map(x=>x.name).filter(Boolean).join(", ")}))
        },
        coverage:{file:null,rows:items.length,records:records.length,rejected:items.length-records.length,dated:records.filter(r=>r.ts).length,droppedFields:[],partial:true},
        note:"Live Spotify Web API window: recently played tracks plus top-item affinity rankings."
      },
      omitted:[
        "Lifetime play counts — the Web API exposes a recent window and affinity rankings, not totals",
        "Repeat and skip behaviour — not exposed by the Web API",
        "Hourly history beyond the recently-played window"
      ]
    };
  }

  return {MAX_FILE_BYTES,parseCSV,parseJSONExport,detectSensitiveKeys,recordFrom,recordsFromRows,recordsFromFile,demoSource,importSource,fromSpotifyApi,DEMO_TARGETS};
})();