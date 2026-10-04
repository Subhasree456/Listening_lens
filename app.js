/* ===========================================================================
   Listening Lens — app.js : orchestration + renderers.

   Data flow (Phase 2):

     source payload ──→ LL.analytics.analyze ──┐
       demo fixture                          │
       imported file      LL.changes.compare ─┼─→ state.*  ──→ render functions
       Spotify API (P3)   LL.insights.build ──┤
                          LL.privacy.describe ┘

   This file performs no metric calculations of its own: every number shown in
   the dashboard comes from the analytics layer, so Demo mode, imported history
   and (Phase 3+) Spotify API data all use one engine and one dashboard.
=========================================================================== */

const U=LL.util;

const state={
  source:null,        // current source payload (records + provenance)
  connected:false,    // true only after a verified Spotify session (Phase 3)
  dark:true,
  rangeKey:"7",       // 7 | 30 | 183 | "all"
  rangeLabel:"Last 7 days",
  analytics:null,     // LL.analytics result
  comparison:null,    // LL.changes result
  insights:[],        // LL.insights result
  privacy:null        // LL.privacy result
};

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];

/* Aliases so the templates below stay readable. */
const esc=U.esc, clamp=U.clamp, hourLabel=U.hourLabel;

const RANGE_OPTIONS={"7":"Last 7 days","30":"Last 30 days","183":"Last 6 months","all":"All loaded history"};

/* ============================== data layer ============================== */
/* One entry point for every source: records in, analysis out. */
function analyzeSource(source){
  state.source=source;
  state.analytics=LL.analytics.analyze(source);
  state.comparison=LL.changes.compare(source.records,{windowDays:7});
  state.insights=LL.insights.build(state.analytics,state.comparison);
  state.privacy=LL.privacy.describe(source,state.analytics);
  return state.analytics;
}
/* Convenience accessors used by the renderers. */
function analytics(){ return state.analytics; }
function sourceRecords(){ return state.source&&Array.isArray(state.source.records)?state.source.records:[]; }
/* Records limited to the selected range, using the shared window helper. */
function rangeSelection(){
  const days=state.rangeKey==="all"?null:Number(state.rangeKey);
  const all=sourceRecords();
  if(days===null) return {records:all,days:null,label:"all loaded history",limited:false};
  const cutoff=Date.now()-days*U.MS_DAY;
  const kept=all.filter(r=>r.ts instanceof Date&&r.ts.getTime()>=cutoff);
  return {records:kept,days,label:state.rangeLabel.toLowerCase(),limited:true};
}
function rangeStats(){ return LL.changes.windowStats(rangeSelection().records); }

function setRange(key){
  state.rangeKey=RANGE_OPTIONS[key]?key:"7";
  state.rangeLabel=RANGE_OPTIONS[state.rangeKey];
  const sel=$("#rangeSelect");
  if(sel) sel.value=state.rangeKey;
}
function resetRange(){ setRange("7"); }

/* Demo mode: the sample fixture is generated as normalised records, so it runs
   through exactly the same engine as real data. */
function loadDemoSource(){
  const source=LL.normalize.demoSource();
  resetRange();
  state.connected=false;
  analyzeSource(source);
  return source;
/* ============================== interaction ============================== */
function toast(msg){
  const el=$("#toast"); el.textContent=msg; el.classList.add("show");
  clearTimeout(window.__toast); window.__toast=setTimeout(()=>el.classList.remove("show"),2600);
}
function showView(view){
  $$(".view").forEach(v=>v.classList.toggle("hidden",v.dataset.panel!==view));
  $$(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  $$(".side-btn").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  if(view==="insights") renderInsights();
  if(view==="behaviour") renderBehaviour();
  if(view==="prediction") renderPrediction();
  if(view==="privacy") renderPrivacy();
}
$$("[data-view]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));

function enterApp(){
  $("#welcome").classList.add("hidden"); $("#app").classList.remove("hidden");
  renderAll(); window.scrollTo({top:0,behavior:"smooth"});
}
$("#demoBtn").onclick=()=>{
  loadDemoSource();                       // replaces, and so clears, any imported data
  enterApp(); toast("Demo dataset loaded — synthetic sample records analysed locally.");
};
$("#connectBtn").onclick=()=>{
  toast("Spotify connection is not enabled in this build. Listening Lens never asks for your Spotify password.");
  showView("privacy");
};
$("#uploadBtn").onclick=()=>$("#fileInput").click();
$("#uploadSide").onclick=()=>$("#fileInput").click();
$("#fileInput").onchange=handleFile;
$("#refreshBtn").onclick=()=>{renderAll();toast("Analysis recalculated from the current records.");};
$("#clearDataBtn").onclick=()=>{
  const sample=state.source&&state.source.coverage&&state.source.coverage.sample;
  if(sample||!sourceRecords().length){
    toast("Nothing imported to clear — demo mode is showing sample data.");
    return;
  }
  loadDemoSource(); renderAll();
  toast("Imported records cleared. Demo dataset is showing.");
};
$("#themeBtn").onclick=()=>{
  state.dark=!state.dark;
  const vars=state.dark
    ?{"--bg":"#07110d","--panel":"#0d1a15","--panel2":"#10231b","--text":"#effff6","--muted":"#91a99d","--line":"rgba(255,255,255,.09)","--shadow":"0 18px 60px rgba(0,0,0,.28)"}
    :{"--bg":"#f5faf7","--panel":"#ffffff","--panel2":"#eef6f1","--text":"#102017","--muted":"#61766b","--line":"rgba(16,32,23,.12)","--shadow":"0 18px 60px rgba(16,32,23,.10)"};
  Object.entries(vars).forEach(([k,v])=>document.documentElement.style.setProperty(k,v));
  document.documentElement.setAttribute("data-theme",state.dark?"dark":"light");
};
$("#exportBtn").onclick=exportReport;

$("#rangeSelect").onchange=()=>{
  setRange($("#rangeSelect").value);
  renderActivity(); renderRangeSummary();
  const a=analytics();
  toast(a.source.kind==="demo"
    ? "The demo dataset spans seven local days, so wider ranges show its full shape."
    : rangeSelection().limited
      ? `Activity recalculated for ${state.rangeLabel.toLowerCase()}.`
      : "Showing all loaded history — this source has no date range to filter by.");
};
}
function loadImportPayload(payload){
  resetRange();
  state.connected=false;
  analyzeSource(payload);
}
/* ============================== reporting ============================== */
/* Aggregates only: no raw listening history, no identifiers, no tokens. */
function exportReport(){
  const a=analytics();
  const range=rangeSelection();
  const stats=rangeStats();
  const report={
    project:"Listening Lens",
    generatedAt:new Date().toISOString(),
    source:{kind:a.source.kind,label:a.source.label,sampleData:!!(a.source.coverage&&a.source.coverage.sample),file:a.source.coverage.file||null},
    range:{selected:state.rangeLabel,playsInRange:stats.plays,datedRecordsInRange:range.records.length},
    dataset:{
      plays:a.volume.plays,
      datedPlays:a.volume.datedPlays,
      listeningMinutes:Math.round(a.volume.minutes),
      averageMsPerPlay:a.volume.averageMsPerPlay,
      uniqueArtists:a.artists.unique,
      uniqueTracks:a.tracks.unique,
      dateRange:a.volume.firstTs?{from:a.volume.firstTs.toISOString(),to:a.volume.lastTs.toISOString()}:null
    },
    topArtists:a.artists.top,
    topTracks:a.tracks.top,
    genres:a.genres.available
      ? a.genres.distribution.map(g=>({genre:g.name,sharePercent:g.share}))
      : {available:false,reason:a.genres.reason},
    metrics:{
      replay:a.repeats.available?{repeatRatePercent:a.repeats.trackRepeatRate,repeatPlays:a.repeats.repeatPlays}:{available:false,reason:a.repeats.reason},
      discovery:a.discovery.available?{singlePlaySharePercent:a.discovery.rate,oneOffArtists:a.discovery.oneOffArtists}:{available:false,reason:a.discovery.reason},
      peakHour:a.hours.available?{hour24:a.hours.peakHour.hour,plays:a.hours.peakHour.plays,sharePercent:a.hours.peakHour.share}:{available:false,reason:a.hours.reason},
      mostActiveDay:a.days.available?{day:a.days.mostActiveDay.name}:{available:false,reason:a.days.reason},
      consistency:a.days.consistency!==null?a.days.consistency:{available:false,reason:a.days.consistencyReason}
    },
    musicDna:a.dna.map(d=>({metric:d.label,value:d.value,basis:d.basis})),
    behaviourSignals:a.signals.map(s=>({signal:s.label,value:s.score,basis:s.basis})),
    predictionMethod:a.prediction.method,
    comparison:state.comparison&&state.comparison.available
      ? {windowDays:state.comparison.windowDays,plays:state.comparison.deltas.plays,listeningTimeMs:state.comparison.deltas.listeningTime,newArtists:state.comparison.newArtists}
      : {available:false,reason:state.comparison?state.comparison.reason:"not calculated"},
    privacy:{persisted:false,fieldsUsed:state.privacy.fieldsUsed,fieldsDiscarded:state.privacy.fieldsDiscarded,network:state.privacy.processingLocation.network},
    disclaimer:"Behavioural observations calculated from listening history only. Not medical, psychological or personality assessments."
  };
  const blob=new Blob([JSON.stringify(report,null,2)],{type:"application/json"});
  const link=document.createElement("a");
  link.href=URL.createObjectURL(blob); link.download="listening-lens-report.json"; link.click();
  URL.revokeObjectURL(link.href);
  toast("Report exported — aggregates only, no raw history or tokens.");
}

/* ============================== rendering ============================== */
/* Every renderer reads from state.analytics / state.insights / state.privacy.
   Nothing here calculates a metric or invents a value. */
function setText(sel,text){ const el=$(sel); if(el) el.textContent=text; }
function emptyState(sel,msg){ const el=$(sel); if(el) el.innerHTML=`<p class="empty-state">${esc(msg)}</p>`; }
function scoreCell(value){ return value===null||value===undefined?"n/a":`${clamp(value,0,100)}/100`; }

function renderAll(){
  renderMode();
  renderStats();
  renderArtists();
  renderActivity();
  renderRangeSummary();
  renderDna();
  renderHeat();
  renderInsights();
  renderBehaviour();
  renderPrediction();
  renderPrivacy();
  renderDataPanel();
}

/* Mode indicator, profile line and stat captions. */
function renderMode(){
  const a=analytics(), v=a.volume, sample=!!(a.source.coverage&&a.source.coverage.sample);
  setText("#dataSummary", sample
    ? `Demo dataset · ${U.fmtNumber(v.plays)} synthetic sample records · no account needed`
    : `${a.source.label} · ${U.fmtNumber(v.plays)} records${v.rangeText?` · ${v.rangeText}`:""}`);
  setText("#avatar", sample?"D":"I");
  setText("#profileName", sample?"Demo Listener":"Imported Listener");
  setText("#profileState", sample
    ? "Demo mode · sample records"
    : a.hours.available?`${a.source.label} · in memory only`:`${a.source.label} · no usable timestamps`);
  setText("#statMinutesNote", sample
    ? "Sample records, analysed locally"
    : `Average ${U.fmtMinutes(v.averageMsPerPlay||0)} per play · ${U.fmtNumber(v.datedPlays)} dated`);
  setText("#statArtistsNote", a.artists.available
    ? `${U.fmtNumber(a.artists.unique)} artists across ${U.fmtNumber(v.plays)} plays`
    : a.artists.reason);
  setText("#statReplayNote", a.repeats.available
    ? "Repeat behaviour — see Insights for the measurement"
    : a.repeats.reason);
}

function renderStats(){
  const a=analytics();
  setText("#statMinutes", a.volume.hoursText);
  setText("#statArtists", U.fmtNumber(a.artists.unique));
  setText("#statGenre", a.genres.available?a.genres.distribution[0].name:"Not available");
  setText("#genreDetail", a.genres.available
    ? `${a.genres.distribution[0].share}% of tagged plays · ${a.genres.source}`
    : "Needs Spotify API genre data");
  const replay=$("#statReplay");
  if(replay) replay.innerHTML=a.repeats.available
    ? `${clamp(Math.round(a.repeats.trackRepeatRate),0,100)}<span>/100</span>`
    : "n/a";
}

function renderArtists(){
  const a=analytics();
  if(!a.artists.available){ emptyState("#artistList",a.artists.reason); return; }
  const meta=a.source.coverage&&a.source.coverage.sample?"Sample data":"From loaded records";
  $("#artistList").innerHTML=a.artists.top.map(([name,count])=>{
    const initials=(String(name).split(/\s+/).filter(Boolean).map(w=>Array.from(w)[0]).join("").slice(0,2)||"?").toUpperCase();
    return `<div class="artist"><div class="artist-avatar">${esc(initials)}</div><div><div class="artist-name">${esc(name)}</div><div class="artist-meta">${esc(meta)}</div></div><div class="artist-count">${U.fmtNumber(count)} plays</div></div>`;
  }).join("");
}

/* Weekly activity for the selected range, from the same records the engine used. */
function renderActivity(){
  const stats=rangeStats();
  const sel=rangeSelection();
  const a=analytics();
  let subtitle,problem="";
  if(!a.hours.available&&!a.volume.datedPlays){
    subtitle=`Plays by weekday · ${sel.label} · no usable timestamps in this source`;
  } else {
    subtitle=`Plays by weekday · ${sel.label} · ${U.fmtNumber(stats.plays)} of ${U.fmtNumber(a.volume.plays)} plays in range`;
    if(!stats.plays) problem="None of the records fall inside this range. Choose a wider range.";
  }
  setText("#activityNote", subtitle);
  if(problem||!stats.weekdays.some(v=>v>0)){
    emptyState("#activityChart", problem||"No listening activity to chart yet.");
    return;
  }
  const max=Math.max(...stats.weekdays);
  $("#activityChart").innerHTML=stats.weekdays.map((v,i)=>{
    const height=v===0?0:Math.max(6,v/max*100);      // a zero bucket must not draw a bar
    return `<div class="bar-wrap"><div class="bar" style="height:${height.toFixed(2)}%" title="${U.DAYS[i]} · ${U.fmtNumber(v)} plays"></div></div>`;
  }).join("");
}

/* Shows exactly which records the range control currently includes. */
function renderRangeSummary(){
  const a=analytics(), sel=rangeSelection(), stats=rangeStats();
  const pct=a.volume.plays?U.round(stats.plays/a.volume.plays*100,1):0;
  const facts=[
    ["Range", sel.label],
    ["Plays in range", `${U.fmtNumber(stats.plays)} of ${U.fmtNumber(a.volume.plays)} (${pct}%)`],
    ["Listening in range", U.fmtHours(stats.ms)],
    ["Artists in range", U.fmtNumber(stats.uniqueArtists)],
    ["Tracks in range", U.fmtNumber(stats.uniqueTracks)]
  ];
  $("#rangeSummary").innerHTML=facts.map(([k,v])=>`<div class="fact"><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join("");
  setText("#rangeNote", a.volume.datedPlays?"Filtered by record timestamps":"No timestamps in this source");
  setText("#rangeStats", a.volume.datedPlays
    ? `Weekday activity and these figures follow the range control. Panels that describe the whole dataset say so.`
    : `This source has no usable timestamps, so a date range cannot be applied — the figures above describe every loaded record.`);
}
/* Music DNA and the weekday × hour map. */
function renderDna(){
  const a=analytics();
  $("#dnaBars").innerHTML=a.dna.map(d=>`<div class="dna-row" title="${esc(d.basis)}"><div class="dna-row-top"><span>${esc(d.label)}</span><span>${scoreCell(d.value)}</span></div><div class="progress"><i style="width:${d.value===null?0:clamp(d.value,0,100)}%"></i></div></div>`).join("");
}

function renderHeat(){
  const a=analytics(), heat=a.heat;
  if(!heat.available){
    setText("#heatNote","When you listen most");
    emptyState("#heatmap", heat.reason);
    $("#heatAxis").innerHTML=""; $("#heatBands").innerHTML="";
    return;
  }
  setText("#heatNote", heat.peak
    ? `Peak: ${heat.peak.dayName} ${U.shortHour(heat.peak.hour)} · ${U.fmtNumber(heat.peak.plays)} plays`
    : "When you listen most");
  const cells=[];
  heat.matrix.forEach((row,day)=>{
    cells.push(`<b class="heat-name">${esc(heat.dayNames[day])}</b>`);
    row.forEach((plays,hour)=>{
      cells.push(`<i class="heat" style="opacity:${(0.18+0.82*(plays/heat.max)).toFixed(2)}" title="${esc(heat.dayNames[day])} ${String(hour).padStart(2,"0")}:00 · ${U.fmtNumber(plays)} plays"></i>`);
    });
  });
  $("#heatmap").innerHTML=cells.join("");
  $("#heatAxis").innerHTML="<span></span>"+Array.from({length:24},(_,h)=>`<span>${h%6===0?String(h).padStart(2,"0"):""}</span>`).join("");
  $("#heatBands").innerHTML=analytics().hours.available
    ? analytics().hours.bands.map(b=>`<span>${esc(b.name)} ${b.share}%</span>`).join("")
    : "";
}

/* Insights view: genres, hourly timeline, behaviour signals, track rotation. */
function renderInsights(){
  const a=analytics();
  if(!a.genres.available){
    emptyState("#genreChart",a.genres.reason);
  } else {
    const top=a.genres.distribution.slice(0,6);
    $("#genreChart").innerHTML=top.map(g=>`<div class="hrow" title="${esc(g.plays)} plays"><span>${esc(g.name)}</span><div class="hbar"><i style="width:${clamp(g.share,0,100)}%"></i></div><b>${g.share}%</b></div>`).join("");
  }

  if(!a.hours.available){
    setText("#timelineNote","Plays by hour of day");
    emptyState("#timelineChart",a.hours.reason);
  } else {
    setText("#timelineNote",`Plays by hour of day · ${U.fmtNumber(a.hours.total)} dated plays · device local time`);
    const max=Math.max(...a.hours.histogram,1);
    $("#timelineChart").innerHTML=a.hours.histogram.map((plays,h)=>`<i class="tbar" style="height:${(plays/max*100).toFixed(2)}%" title="${String(h).padStart(2,"0")}:00 · ${U.fmtNumber(plays)} plays"></i>`).join("");
  }

  /* Each signal states the measurement behind its score. */
  $("#signals").innerHTML=a.signals.map(s=>`<div class="signal" title="${esc(s.basis)}"><div><b>${esc(s.label)}</b><span>${esc(s.text)}</span></div><em class="${s.available?"":"na"}">${scoreCell(s.score)}</em></div>`).join("");

  if(!a.tracks.available){
    emptyState("#trackList",a.tracks.reason);
  } else {
    $("#trackList").innerHTML=a.tracks.top.map(([track,artist,count])=>`<div class="track"><div><b>${esc(track)}</b><span>${esc(artist)}</span></div><b>${U.fmtNumber(count)}×</b></div>`).join("");
  }
}
/* Behaviour view: structured insights from LL.insights + the period comparison. */
function renderBehaviour(){
  const a=analytics();
  const summary=LL.insights.counts(state.insights);
  setText("#behaviourSummary", a.source.coverage&&a.source.coverage.sample
    ? "Observations calculated from the synthetic demo records. Real imports use the same engine."
    : `Observations calculated from ${U.fmtNumber(a.volume.plays)} loaded records.`);
  setText("#behaviourNote", `${summary.available} of ${summary.total} insight(s) available · each states its measurement`);

  $("#behaviourInsights").innerHTML=state.insights.map(i=>i.available
    ? `<div class="insight" title="${esc(i.basis)}"><header><b>${esc(i.label)}</b><span class="kind">${esc(i.type.replace(/_/g," "))}</span></header>${i.detail?`<p>${esc(i.detail)}</p>`:""}<div class="basis">${esc(i.basis)}</div></div>`
    : `<div class="insight off"><header><b>Not available</b><span class="kind">${esc(i.type.replace(/_/g," "))}</span></header><p>${esc(i.reason)}</p>${i.basis?`<div class="basis">${esc(i.basis)}</div>`:""}</div>`
  ).join("");

  renderChangePanel();
}

/* Period comparison. Insufficient data is stated, never guessed. */
function renderChangePanel(){
  const c=state.comparison;
  setText("#changeNote", c&&c.available
    ? `Last ${c.windowDays} days against the ${c.windowDays} days before`
    : "Recent window against the window before it");
  if(!c||!c.available){
    emptyState("#changePanel", c?c.reason:"No period comparison was calculated.");
    return;
  }
  const rows=(label,delta,base,format)=>{
    const value=format?format(delta.absolute):U.fmtNumber(delta.absolute);
    const pct=delta.percent===null?"":" ("+(delta.percent>0?"+":"")+delta.percent+"%)";
    return `<div class="change-row"><div>${esc(label)}<div class="base">${esc(base)}</div></div><b>${esc(value)}</b><span class="delta ${esc(delta.direction)}">${delta.direction==="up"?"▲":delta.direction==="down"?"▼":"–"} ${esc(pct.trim())}</span></div>`;
  };
  const d=c.deltas;
  const html=[
    rows("Plays",d.plays,`was ${U.fmtNumber(c.previous.plays)}`),
    rows("Listening time",d.listeningTime,`was ${U.fmtHours(c.previous.ms)}`,v=>U.fmtHours(v)),
    rows("Unique artists",d.uniqueArtists,`was ${U.fmtNumber(c.previous.uniqueArtists)}`),
    rows("Unique tracks",d.uniqueTracks,`was ${U.fmtNumber(c.previous.uniqueTracks)}`),
    d.repeatRate?rows("Repeat rate",d.repeatRate,`was ${c.previous.repeatRate}/100`,v=>`${U.round(v,1)}/100`):"",
    d.msPerPlay?rows("Average play length",d.msPerPlay,`was ${U.fmtMinutes(c.previous.msPerPlay)}`,v=>U.fmtMinutes(v)):""
  ].filter(Boolean).join("");
  const extras=[
    `<div class="change-row"><div>New artists<div class="base">appear in the recent window only</div></div><b>${U.fmtNumber(c.newArtists.count)}</b><span class="delta flat">${esc(c.newArtists.names.slice(0,2).join(", ")||"—")}</span></div>`,
    c.hourlyShift&&c.hourlyShift.distance!==null
      ? `<div class="change-row"><div>Hourly pattern shift<div class="base">0 = identical, 1 = completely different</div></div><b>${c.hourlyShift.distance}</b><span class="delta ${c.hourlyShift.distance>=0.2?"":"flat"}">${c.hourlyShift.distance>=0.2?"changed":"similar"}</span></div>`
      : ""
  ].filter(Boolean).join("");
  const notes=c.notes.concat((state.privacy.limitations||[]).slice(0,1)).map(n=>`<p class="empty-state">${esc(n)}</p>`).join("");
  $("#changePanel").innerHTML=html+extras+notes;
}

/* Prediction view. Frequency-based; no trained model; n/a where unsupported. */
function renderPrediction(){
  const a=analytics(), p=a.prediction, boxes=p.boxes;
  setText("#predHero", p.hero.available?p.hero.value:"n/a");
  setText("#predHeroLabel", p.hero.available?`${p.hero.label} · frequency-based`:"no artist data available");
  setText("#predGenreLabel", p.genre.available?"MOST COMMON GENRE":"GENRE DATA");
  setText("#predGenre", p.genre.available?p.genre.value:"Not available");
  setText("#predMethod", p.genre.available
    ? `${p.methodText} ${p.genre.detail}`
    : `${p.methodText} ${p.genre.detail}`);
  $("#predChips").innerHTML=p.chips.map(c=>`<span>${esc(c)}</span>`).join("");
  setText("#predArtist", boxes.artist.value);
  setText("#predArtistScore", boxes.artist.score);
  setText("#predArtistNote", boxes.artist.note);
  setText("#predHour", boxes.hour.value);
  setText("#predHourScore", boxes.hour.score);
  setText("#predHourNote", boxes.hour.note);
  setText("#predDiscovery", boxes.discovery.value);
  setText("#predDiscoveryScore", boxes.discovery.score);
  setText("#predDiscoveryNote", boxes.discovery.note);

  /* Dashboard "Next up" card: genre when genres exist, else the strongest figure
     the data does support. */
  if(p.genre.available){
    setText("#nextGenre", p.genre.value);
    setText("#nextCardNote", a.source.coverage&&a.source.coverage.sample?"Demo estimate · sample records":"Most common genre");
    setText("#nextConfidence", boxes.artist.score);
    setText("#nextLabel", boxes.artist.note);
  } else {
    setText("#nextGenre", boxes.artist.value);
    setText("#nextCardNote", "Top artist · from your records");
    setText("#nextConfidence", boxes.artist.score);
    setText("#nextLabel", boxes.artist.note);
  }
  setText("#nextFoot", a.source.coverage&&a.source.coverage.sample
    ? "Demo records analysed by the real engine — frequency-based, not a trained model."
    : "Frequency-based from your loaded records — not a trained model, and not a personality assessment.");
}
/* Privacy view: facts about what is held right now (no invented score). */
function renderPrivacy(){
  const p=state.privacy;
  if(!p) return;
  const a=analytics();
  setText("#privacySource", `${p.source.label}${p.source.sampleData?" · sample records":""}`);
  const facts=[
    ["Source", p.source.label+(p.source.file?` (${p.source.file})`:""), p.source.capabilities.note],
    ["Records in memory", U.fmtNumber(p.recordsInMemory), p.stored.detail],
    ["Fields used", p.fieldsUsed.join(", "), "The complete set of per-play fields analytics receives."],
    ["Fields discarded", p.fieldsDiscarded.length?p.fieldsDiscarded.join(", "):"none present in this source", "Detected and dropped at import time — never stored."],
    ["Never collected", `${p.fieldsNotCollected.length} field types`, p.fieldsNotCollected.slice(0,4).join(", ")+"…"],
    ["Stored where", p.stored.location, p.stored.doesNotStore.join(" · ")],
    ["Retention", p.retention.retainedUntil, `Server-side copy: ${p.retention.serverSideCopy}`],
    ["Processing", p.processingLocation.where, p.processingLocation.network],
    ["Deletion", p.deletion.options.map(o=>o.action).join(" · "), p.deletion.serverSide],
    ["Tokens", p.tokens.storage, p.tokens.detail]
  ];
  $("#privacyFacts").innerHTML=facts.map(([k,v,detail])=>`<div class="fact" title="${esc(detail||"")}"><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join("");

  const summary=LL.privacy.checkSummary(p);
  setText("#privacyCheckSummary", `${summary.pass} pass · ${summary.warn} warn · ${summary.notApplicable} not applicable`);
  $("#privacyChecks").innerHTML=p.checks.map(c=>`<div class="check"><span class="pill ${esc(c.status)}">${esc(c.status==="not-applicable"?"n/a":c.status)}</span><div><b>${esc(c.label)}</b><p>${esc(c.detail)}</p></div></div>`).join("");

  if(p.limitations.length) $("#privacyChecks").innerHTML+=p.limitations.map(l=>`<p class="empty-state">${esc(l)}</p>`).join("");
  void a;
}

/* Dashboard panel: exactly what is loaded in this session. */
function renderDataPanel(){
  const a=analytics(), cov=a.source.coverage||{}, sample=!!cov.sample;
  setText("#dataSessionNote", sample?"Built-in sample records":"Imported records held in memory only");
  const rows=[
    ["Source", a.source.label],
    ["Records loaded", `${U.fmtNumber(a.volume.plays)} (${U.fmtNumber(a.volume.datedPlays)} dated)`],
    ["Rows rejected on import", sample?"—":U.fmtNumber(cov.rejected||0)],
    ["Sensitive fields dropped", cov.droppedFields&&cov.droppedFields.length?cov.droppedFields.join(", "):"none present"],
    ["Kept where", sample?"Generated in this tab — nothing was read from disk":"Browser memory only (no storage, no server)"],
    ["Cleared by", "Switching to Demo mode, or reloading the tab"]
  ];
  if(cov.rejectedSamples&&cov.rejectedSamples.length){
    rows.push(["Examples of rejected rows", cov.rejectedSamples.join(" | ")]);
  }
  $("#dataPanel").innerHTML=`<div class="facts">${rows.map(([k,v])=>`<div class="fact"><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join("")}</div>`;
  const clear=$("#clearDataBtn");
  if(clear){
    clear.disabled=sample||!a.volume.plays;
    clear.style.opacity=sample||!a.volume.plays?"0.45":"1";
  }
}

/* ========================== import pipeline ========================== */
/* Fixed, mapped messages — raw parse errors never reach the UI, so file
   contents cannot leak into messages. */
function importErrorMessage(err){
  switch(err&&err.message){
    case "large":  return "That file is larger than 40 MB. Import one export file at a time.";
    case "json":   return "That JSON file could not be parsed. Check that it is a Spotify export file.";
    case "shape":  return "Unexpected file structure. Expected a Spotify listening-history array or CSV.";
    case "empty":  return "That file contains no rows.";
    case "norows": return "No recognisable listening rows were found. Expected fields such as master_metadata_*, artistName/trackName or artist_name/track_name.";
    default:       return "Could not read this file. Try Spotify JSON, CSV or Extended Streaming History.";
  }
}
async function handleFile(e){
  const input=e.target;
  const file=input.files?input.files[0]:null;
  input.value="";                          // allows re-importing the same file
  if(!file) return;
  try{
    const read=await LL.normalize.recordsFromFile(file);
    const payload=LL.normalize.importSource(read);
    loadImportPayload(payload);
    enterApp();
    const cov=payload.coverage;
    const bits=[`Imported ${U.fmtNumber(cov.records)} listening records into memory`];
    if(cov.droppedFields.length) bits.push(`dropped ${cov.droppedFields.join(", ")}`);
    if(cov.rejected>0) bits.push(`${U.fmtNumber(cov.rejected)} row(s) skipped`);
    const undated=cov.records-cov.dated;
    if(undated>0) bits.push(`${U.fmtNumber(undated)} without a usable timestamp`);
    toast(bits.join(" · ")+".");
  }catch(err){
    toast(importErrorMessage(err));
  }
}

/* ============================== start-up ============================== */
function boot(){
  loadDemoSource();
  renderAll();
}
if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot);
else boot();