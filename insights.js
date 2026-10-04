/* ===========================================================================
   Listening Lens — insights.js   (LL.insights)

   Turns an analytics result into reusable, structured listening-behaviour
   observations. Nothing here touches the DOM: every entry is data, and the
   renderer decides how (or whether) to display it.

     {type, available, value, label, detail, basis, reason?}

   Every label is a statement about listening behaviour only — never about
   personality, mood or health.
=========================================================================== */
LL.insights = (function(){
  const U=LL.util;

  function ok(type,value,label,detail,basis){
    return {type,available:true,value,label,detail,basis};
  }
  function na(type,reason,basis){
    return {type,available:false,value:null,label:"",detail:"",basis:basis||"",reason};
  }

  function timingInsights(out,engine){
    if(engine.hours.available&&engine.hours.peakHour){
      const p=engine.hours.peakHour;
      out.push(ok("peak_hour",p.hour,
        `Your peak listening hour is ${U.shortHour(p.hour)}`,
        `${U.hourLabel(p.hour)} accounts for ${U.fmtNumber(p.plays)} of ${U.fmtNumber(engine.volume.datedPlays)} dated plays.`,
        `Plays counted per hour of day across ${U.fmtNumber(engine.volume.datedPlays)} dated plays (device local time).`));
      const second=engine.hours.topHours[1];
      if(second&&p.plays>0&&second.plays/p.plays>=0.7){
        out.push(ok("secondary_hour",second.hour,
          `${U.shortHour(second.hour)} is a close second`,
          `${U.hourLabel(second.hour)} has ${U.fmtNumber(second.plays)} plays, close behind your peak hour.`,
          "Comparing the two busiest hours."));
      }
    } else {
      out.push(na("peak_hour",engine.hours.reason||"Hourly analysis is not available for this source."));
    }

    if(engine.days.available&&engine.days.mostActiveDay){
      const d=engine.days.mostActiveDay;
      const share=engine.volume.plays?U.round(d.plays/engine.volume.plays*100,1):null;
      out.push(ok("most_active_day",d.index,
        `${d.name} is your most active listening day`,
        `${U.fmtNumber(d.plays)} plays${share!==null?` — ${share}% of the ${U.fmtNumber(engine.volume.plays)} plays analysed`:""}.`,
        "Plays counted per weekday."));
    } else {
      out.push(na("most_active_day",engine.days.reason||"Weekday analysis is not available for this source."));
    }

    if(engine.days.consistency!==null){
      const v=engine.days.consistency;
      out.push(ok("listening_consistency",v,
        v>=60?"Your daily listening volume is fairly steady":v>=30?"Your daily listening volume varies from day to day":"Your listening is concentrated in a few heavier days",
        `Spread across ${engine.days.activeDays} active day(s) scores ${v}/100 (100 = the same number of plays every day).`,
        "Variation (coefficient of variation) of plays per active day."));
    } else {
      out.push(na("listening_consistency",engine.days.consistencyReason||"Not enough dated history to measure day-to-day variation."));
    }
  }

  function behaviourInsights(out,engine){
    if(engine.repeats.available){
      const v=engine.repeats.trackRepeatRate;
      out.push(ok("repeat_listening",v,
        v>=70?"You frequently return to a small set of tracks":v>=40?"Your listening mixes repeats with tracks you had not played before":"Most plays are tracks you had not played before",
        `${v}/100 of plays are repeats of a track you had already played (${U.fmtNumber(engine.repeats.repeatPlays)} of ${U.fmtNumber(engine.volume.plays)}).`,
        "Share of plays that are not the first play of that track."));
    } else {
      out.push(na("repeat_listening",engine.repeats.reason));
    }

    if(engine.artists.loyalty&&engine.artists.loyalty.available){
      const l=engine.artists.loyalty;
      out.push(ok("artist_loyalty",l.topArtistShare,
        l.topArtistShare>=25?`${l.topArtist} accounts for a large share of your listening`:"Your listening is spread across many artists",
        `${l.topArtist} has ${U.fmtNumber(l.topArtistPlays)} plays (${l.topArtistShare}% of all plays); ${U.fmtNumber(l.oneOffArtists)} artist(s) appear once.`,
        "Play counts per artist."));
    } else {
      out.push(na("artist_loyalty","No artist data is available in this source."));
    }

    if(engine.discovery.available){
      const v=engine.discovery.rate;
      out.push(ok("discovery_vs_repeat",v,
        v>=60?"A large share of plays come from artists you played only once":v>=25?"Some listening comes from single-play artists; most comes from artists you return to":"Almost all listening comes from artists you return to",
        `${U.fmtNumber(engine.discovery.oneOffPlays)} of ${U.fmtNumber(engine.volume.plays)} plays are by artists played exactly once.`,
        "Plays by artists with a single play, as a share of all plays."));
    } else {
      out.push(na("discovery_vs_repeat",engine.discovery.reason));
    }

    if(engine.genres.available){
      const top=engine.genres.distribution[0];
      out.push(ok("genre_diversity",engine.genres.distinct,
        engine.genres.distinct>=5?"Your listening spans several genre clusters":`Your listening covers ${engine.genres.distinct} genre(s)`,
        `${engine.genres.distinct} genre(s) across ${U.fmtNumber(engine.volume.plays)} plays; ${top.name} leads with ${top.share}%.`,
        `Genres provided by ${engine.genres.source}.`));
    } else {
      out.push(na("genre_diversity",engine.genres.reason));
    }
  }

  /* Period-change observations. Statistical only. */
  function changeInsights(out,comparison){
    if(!comparison||!comparison.available){
      out.push(na("activity_change",comparison?comparison.reason:"No period comparison was calculated."));
      return;
    }
    const d=comparison.deltas;
    const pct=d.plays?d.plays.percent:null;
    out.push(ok("activity_change",pct,
      (pct!==null&&Math.abs(pct)>=25)
        ? `Your listening activity ${d.plays.direction==="up"?"rose":"fell"} ${Math.abs(pct)}% compared with the previous ${comparison.windowDays} days`
        : `Your listening activity is close to your previous ${comparison.windowDays} days`,
      `${U.fmtNumber(comparison.current.plays)} plays in the last ${comparison.windowDays} days versus ${U.fmtNumber(comparison.previous.plays)} in the ${comparison.windowDays} days before.`,
      "Play counts compared across two consecutive equal-length windows."));
    if(comparison.newArtists&&comparison.newArtists.count){
      out.push(ok("new_artist_discovery",comparison.newArtists.count,
        `${comparison.newArtists.count} artist(s) appear in your recent listening but not in the previous period`,
        comparison.newArtists.names.length?`Including: ${comparison.newArtists.names.join(", ")}.`:"",
        "Set difference between the artists of two consecutive windows."));
    }
    const shift=comparison.hourlyShift;
    if(shift&&shift.distance!==null&&shift.distance>=0.2&&shift.changedHours.length){
      const h=shift.changedHours[0];
      out.push(ok("hourly_shift",shift.distance,
        `Your listening hours moved most around ${U.shortHour(h.hour)}`,
        `${U.hourLabel(h.hour)} is ${h.change>0?"up":"down"} ${Math.abs(h.change)} percentage points versus the previous ${comparison.windowDays} days.`,
        "Difference between the hourly distributions of two consecutive windows."));
    }
  }

  function build(engine,comparison){
    const out=[];
    if(!engine) return out;
    timingInsights(out,engine);
    behaviourInsights(out,engine);
    changeInsights(out,comparison);
    return out;
  }

  function counts(list){
    const l=Array.isArray(list)?list:[];
    return {total:l.length,available:l.filter(i=>i.available).length,unavailable:l.filter(i=>!i.available).length};
  }

  return {build,counts,ok,na};
})();