/* ===========================================================================
   Listening Lens — privacy.js   (LL.privacy)

   Describes what data the application currently holds, in a structured form
   that the Privacy/Security section can render later (Phase 7).

     {source, fieldsUsed, fieldsDiscarded, stored, retention,
      processingLocation, tokens, deletion, checks[]}

   `checks` states facts about this build with a status of
   "pass" | "warn" | "not-applicable". No combined score is produced here —
   scoring is a later phase and must be derived from these same facts.
=========================================================================== */
LL.privacy = (function(){
  const U=LL.util;

  /* Facts that are true of the current build, independent of the data source. */
  const BUILD_FACTS={
    tokenStorage:"No access or refresh tokens exist or are stored in this build.",
    credentials:"No Spotify password, client secret or API key is present in front-end code.",
    network:"Analysis runs entirely in this browser tab; no listening data is transmitted.",
    telemetry:"No analytics, logging or error-reporting service is configured."
  };

  function check(id,label,status,detail){
    return {id,label,status,detail};
  }

  const NOT_COLLECTED=[
    "IP address","user agent","country / connection metadata","device platform",
    "Spotify username or account identifiers","album and episode metadata",
    "playback reasons (clickrow / trackdone)","shuffle, offline and incognito flags"
  ];

  function buildChecks(kind,coverage,fieldsUsed){
    return [
      check("scopes","Minimum permissions requested",
        kind==="spotify_api"?"not-applicable":"pass",
        kind==="spotify_api"
          ? "Live Spotify connection is not enabled in this build; when it is, only top-items and recently-played scopes are needed."
          : "No Spotify authorisation is active, so no scopes are requested at all."),
      check("tokens","No tokens in localStorage or sessionStorage","pass",BUILD_FACTS.tokenStorage),
      check("tokens-server","Tokens kept away from the browser",
        kind==="spotify_api"?"warn":"not-applicable",
        kind==="spotify_api"
          ? "A live connection must exchange and hold tokens server-side, never in this page."
          : "No tokens exist in this build."),
      check("secrets","No credentials in front-end code","pass",BUILD_FACTS.credentials),
      check("minimisation","Only the four analysis fields are retained","pass",
        `Kept: ${fieldsUsed.join(", ")}. Discarded: ${NOT_COLLECTED.length} field types analytics does not need.`),
      check("sanitisation","Imported values are escaped before rendering","pass",
        "Artist, track and label values are HTML-escaped, so a crafted file cannot inject markup into the page."),
      check("retention","Raw imports are not persisted","pass",
        "Records are held in memory only; no storage API is used."),
      check("deletion","Imported data can be cleared at any time","pass",
        "Switching to Demo mode clears the in-memory records; reloading or closing the tab also clears them."),
      check("network","No data leaves the device","pass",BUILD_FACTS.network),
      check("logging","No sensitive logging","pass",BUILD_FACTS.telemetry),
      check("https","HTTPS required in production",kind==="http"?"warn":"not-applicable",
        "This build runs from the local file system. A deployed version must be served over HTTPS."),
      check("cors","CORS restricted to trusted origins",
        kind==="spotify_api"?"warn":"not-applicable",
        "A server-side API layer is required before a live Spotify connection; it must restrict allowed origins.")
    ].concat(
      (coverage.droppedFields||[]).length
        ? [check("import-stripping","Sensitive export fields discarded on import","pass",
            `Removed from ${coverage.file||"the imported file"}: ${coverage.droppedFields.join(", ")}.`)]
        : []
    );
  }
function describe(source,engine){
    const src=source||{};
    const kind=src.kind||"import";
    const caps=LL.model.capabilities(kind);
    const coverage=src.coverage||{};
    const records=Array.isArray(src.records)?src.records:[];

    const stored={
      persisted:false,
      location:"Browser memory (RAM) only",
      stores:["In-memory array of normalised records while the page is open"],
      doesNotStore:[
        "localStorage / sessionStorage","cookies","IndexedDB",
        "any server or database","the raw imported file after parsing"
      ],
      detail:records.length
        ? `${U.fmtNumber(records.length)} normalised record(s) are held in memory while the page is open. Reloading, or choosing another source, clears them.`
        : "No records are loaded — the dashboard is showing the built-in sample dataset."
    };

    const limitations=[
      caps.completeHistory===false
        ? "This source provides only a partial window of listening, so totals and repeat behaviour are incomplete."
        : null,
      coverage.sample?"The dataset on screen is sample data, not a real account.":null,
      engine&&engine.source&&engine.source.capabilities&&engine.source.capabilities.genres===false
        ? "Genre figures are unavailable because this source carries no genre tags."
        : null
    ].filter(Boolean);

    return {
      source:{
        kind,
        label:src.label||caps.label||"Imported data",
        sampleData:!!coverage.sample,
        file:coverage.file||null,
        capabilities:caps
      },
      recordsInMemory:records.length,
      fieldsUsed:LL.model.RECORD_FIELDS.slice(),
      fieldsDiscarded:(coverage.droppedFields||[]).slice(),
      fieldsNotCollected:NOT_COLLECTED.slice(),
      stored,
      retention:{
        retainedUntil:records.length?"Page reload, choosing Demo mode, or closing the tab":"n/a — nothing user-specific is loaded",
        serverSideCopy:"None",
        backup:"None"
      },
      processingLocation:{
        where:"This browser tab (client-side JavaScript)",
        thirdParties:"None — there is no upload endpoint",
        network:BUILD_FACTS.network
      },
      network:{calls:[],detail:BUILD_FACTS.network},
      tokens:{present:false,storage:"none",detail:BUILD_FACTS.tokenStorage},
      deletion:{
        options:[
          {action:"Switch to Demo mode",detail:"Discards the imported records held in memory."},
          {action:"Reload or close the tab",detail:"Clears everything held in memory."}
        ],
        serverSide:"Nothing to delete — no server-side copy exists."
      },
      limitations,
      checks:buildChecks(kind,coverage,LL.model.RECORD_FIELDS)
    };
  }

  function checkSummary(privacy){
    const list=(privacy&&privacy.checks)||[];
    return {
      total:list.length,
      pass:list.filter(c=>c.status==="pass").length,
      warn:list.filter(c=>c.status==="warn").length,
      notApplicable:list.filter(c=>c.status==="not-applicable").length
    };
  }

  return {describe,checkSummary,BUILD_FACTS,NOT_COLLECTED};
})();