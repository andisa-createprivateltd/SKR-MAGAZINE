const FIFA_PAGE_URL = "https://cxm-api.fifa.com/fifaplusweb/api/pages/en/tournaments/mens/worldcup/canadamexicousa2026";
const FIFA_NEWS_URL = "https://cxm-api.fifa.com/fifaplusweb/api/sections/news/1aQDyhkYnKhkAW347zYi4Y?locale=en&limit=6";
const FIFA_SEASON_URL = "https://api.fifa.com/api/v3/seasons/285023?language=en";
const FIFA_MATCHES_URL = "https://api.fifa.com/api/v3/calendar/matches?language=en&count=500&idSeason=285023";
const FOOTBALL_DATA_MATCHES_URL = "https://api.football-data.org/v4/matches";
const CACHE_TTL_MS = 60 * 1000;

let cachedPayload = null;
let cachedAt = 0;

function setHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
}

function description(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return description(value.find(Boolean));
  if (value && typeof value === "object") {
    return String(value.Description || value.description || value.Name || value.name || "").trim();
  }
  return "";
}

function isoDate(value) {
  const time = Date.parse(String(value || ""));
  return Number.isNaN(time) ? "" : new Date(time).toISOString();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const FLAG_BY_TEAM = {
  algeria: "🇩🇿",
  argentina: "🇦🇷",
  australia: "🇦🇺",
  austria: "🇦🇹",
  belgium: "🇧🇪",
  "bosnia and herzegovina": "🇧🇦",
  brazil: "🇧🇷",
  canada: "🇨🇦",
  chile: "🇨🇱",
  colombia: "🇨🇴",
  croatia: "🇭🇷",
  czechia: "🇨🇿",
  denmark: "🇩🇰",
  ecuador: "🇪🇨",
  egypt: "🇪🇬",
  england: "🏴",
  france: "🇫🇷",
  germany: "🇩🇪",
  ghana: "🇬🇭",
  iran: "🇮🇷",
  italy: "🇮🇹",
  japan: "🇯🇵",
  mexico: "🇲🇽",
  morocco: "🇲🇦",
  netherlands: "🇳🇱",
  nigeria: "🇳🇬",
  norway: "🇳🇴",
  paraguay: "🇵🇾",
  poland: "🇵🇱",
  portugal: "🇵🇹",
  qatar: "🇶🇦",
  scotland: "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
  senegal: "🇸🇳",
  serbia: "🇷🇸",
  "south africa": "🇿🇦",
  "south korea": "🇰🇷",
  spain: "🇪🇸",
  sweden: "🇸🇪",
  switzerland: "🇨🇭",
  tunisia: "🇹🇳",
  turkiye: "🇹🇷",
  usa: "🇺🇸",
  uruguay: "🇺🇾",
  wales: "🏴󠁧󠁢󠁷󠁬󠁳󠁿"
};

function normalizeTeamName(value) {
  const aliases = {
    "korea republic": "south korea",
    "united states": "usa",
    "united states of america": "usa",
    "ir iran": "iran",
    "turkey": "turkiye"
  };
  const normalized = String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return aliases[normalized] || normalized;
}

function teamFlag(value) {
  return FLAG_BY_TEAM[normalizeTeamName(value)] || "";
}

function inferStatus(providerStatus, startsAt, homeScore, awayScore) {
  if (/live|in progress|first half|second half|half time|extra time|penalt/i.test(providerStatus)) {
    return "live";
  }
  if (/finished|played|full time|after extra time|after penalties/i.test(providerStatus)) {
    return "finished";
  }

  const startTime = Date.parse(startsAt);
  if (Number.isNaN(startTime)) return "upcoming";
  const now = Date.now();
  const hasScore = homeScore !== null && awayScore !== null;
  const twoHoursAfterKickoff = startTime + 2 * 60 * 60 * 1000;

  if (now >= twoHoursAfterKickoff && hasScore) return "finished";
  if (now >= startTime && now < twoHoursAfterKickoff) return "live";
  return "upcoming";
}

function normalizeFifaMatch(match) {
  const home = description(match && match.Home && match.Home.TeamName) || "TBD";
  const away = description(match && match.Away && match.Away.TeamName) || "TBD";
  const stage = description(match && match.StageName) || "World Cup";
  const group = description(match && match.GroupName) || stage;
  const stadium = description(match && match.Stadium && match.Stadium.Name);
  const city = description(match && match.Stadium && match.Stadium.CityName);
  const providerStatus = String(match && (match.MatchStatus || match.Status) || "").toUpperCase();
  const homeScore = numberOrNull(match && match.Home && match.Home.Score);
  const awayScore = numberOrNull(match && match.Away && match.Away.Score);
  const startsAt = isoDate(match && (match.Date || match.LocalDate));

  return {
    id: String(match && (match.IdMatch || match.id) || "").trim(),
    matchNumber: Number(match && match.MatchNumber) || 0,
    stage,
    group,
    home,
    away,
    homeFlag: teamFlag(home),
    awayFlag: teamFlag(away),
    homeScore,
    awayScore,
    startsAt,
    venue: [stadium, city].filter(Boolean).join(", ") || "Venue TBC",
    status: inferStatus(providerStatus, startsAt, homeScore, awayScore),
    providerStatus,
    isFinal: /final/i.test(stage),
    isGroupStage: /first stage/i.test(stage) || /group/i.test(group),
    scheduleProvider: "FIFA"
  };
}

function normalizeFootballDataMatch(match) {
  const homeTeam = match && match.homeTeam || {};
  const awayTeam = match && match.awayTeam || {};
  const score = match && match.score && match.score.fullTime || {};
  const providerStatus = String(match && match.status || "").toUpperCase();
  const liveStatuses = new Set(["IN_PLAY", "PAUSED", "EXTRA_TIME", "PENALTY_SHOOTOUT"]);
  const stage = String(match && match.stage || "World Cup").replace(/_/g, " ");
  const group = String(match && match.group || stage).replace(/_/g, " ");

  return {
    id: String(match && match.id || "").trim(),
    matchNumber: Number(match && match.matchday) || 0,
    stage,
    group,
    home: String(homeTeam.name || homeTeam.shortName || "TBD").trim(),
    away: String(awayTeam.name || awayTeam.shortName || "TBD").trim(),
    homeFlag: String(homeTeam.tla || "").trim(),
    awayFlag: String(awayTeam.tla || "").trim(),
    homeScore: numberOrNull(score.home),
    awayScore: numberOrNull(score.away),
    startsAt: isoDate(match && match.utcDate),
    venue: String(match && match.venue || "Venue TBC").trim(),
    status: liveStatuses.has(providerStatus)
      ? "live"
      : providerStatus === "FINISHED"
        ? "finished"
        : "upcoming",
    providerStatus,
    minute: numberOrNull(match && match.minute),
    isFinal: /final/i.test(stage),
    isGroupStage: /group/i.test(group),
    liveProvider: "football-data.org"
  };
}

function isWorldCupMatch(match) {
  const competition = match && match.competition || {};
  return String(competition.code || "").toUpperCase() === "WC" || /world cup/i.test(String(competition.name || ""));
}

function mergeMatches(fifaMatches, footballMatches) {
  if (!footballMatches.length) return fifaMatches;
  if (!fifaMatches.length) return footballMatches;

  const footballByTeams = new Map();
  footballMatches.forEach((match) => {
    footballByTeams.set(normalizeTeamName(match.home) + "::" + normalizeTeamName(match.away), match);
  });

  const merged = fifaMatches.map((match) => {
    const key = normalizeTeamName(match.home) + "::" + normalizeTeamName(match.away);
    const live = footballByTeams.get(key);
    if (!live) return match;
    footballByTeams.delete(key);
    return {
      ...match,
      homeScore: live.homeScore,
      awayScore: live.awayScore,
      startsAt: live.startsAt || match.startsAt,
      venue: live.venue !== "Venue TBC" ? live.venue : match.venue,
      status: live.status,
      providerStatus: live.providerStatus,
      minute: live.minute,
      liveProvider: live.liveProvider
    };
  });

  return merged.concat(Array.from(footballByTeams.values()));
}

function standings(matches) {
  const groups = new Map();
  matches.filter((match) => match.isGroupStage && /^group\s+[a-z0-9]+/i.test(match.group)).forEach((match) => {
    if (!groups.has(match.group)) groups.set(match.group, new Map());
    const table = groups.get(match.group);
    [match.home, match.away].forEach((name) => {
      if (!table.has(name)) table.set(name, { name, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0 });
    });
    if (match.homeScore === null || match.awayScore === null || match.status === "live") return;
    const home = table.get(match.home);
    const away = table.get(match.away);
    home.played += 1;
    away.played += 1;
    home.goalsFor += match.homeScore;
    home.goalsAgainst += match.awayScore;
    away.goalsFor += match.awayScore;
    away.goalsAgainst += match.homeScore;
    if (match.homeScore > match.awayScore) {
      home.won += 1; home.points += 3; away.lost += 1;
    } else if (match.homeScore < match.awayScore) {
      away.won += 1; away.points += 3; home.lost += 1;
    } else {
      home.drawn += 1; away.drawn += 1; home.points += 1; away.points += 1;
    }
    home.goalDifference = home.goalsFor - home.goalsAgainst;
    away.goalDifference = away.goalsFor - away.goalsAgainst;
  });

  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([group, teamMap]) => ({
    group,
    teams: Array.from(teamMap.values()).sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor || a.name.localeCompare(b.name))
  }));
}

function normalizeNews(payload) {
  return ((payload && payload.items) || []).filter((item) => item && item.title).slice(0, 6).map((item) => ({
    type: String(item.roofline || item.sectionTitle || "FIFA").trim() || "FIFA",
    title: String(item.title || "").trim(),
    source: "FIFA",
    time: String(item.publishedDate || "").slice(0, 10),
    url: String(item.articlePageUrl || "").trim(),
    image: String(item.image && item.image.src || "").trim()
  }));
}

function normalizeHero(payload) {
  const sections = Array.isArray(payload && payload.sections) ? payload.sections : [];
  const hero = sections.find((section) => String(section && section.entryType || "").toLowerCase() === "herosection");
  const first = Array.isArray(hero && hero.items) ? hero.items.find(Boolean) : null;
  if (!first) return null;
  return {
    title: String(first.title || "").trim(),
    description: String(first.description || "").trim(),
    image: String(first.heroImageMobile && first.heroImageMobile.src || first.heroImage && first.heroImage.src || "").trim(),
    url: String(first.readMorePageUrl || "").trim(),
    roofline: String(first.roofline || "").trim(),
    secondary: String(first.rooflineSecondary || "").trim()
  };
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(url + " returned " + response.status);
  return response.json();
}

module.exports = async function handler(req, res) {
  setHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  if (cachedPayload && Date.now() - cachedAt < CACHE_TTL_MS) {
    return res.status(200).json({ ...cachedPayload, cached: true });
  }

  const footballToken = process.env.FOOTBALL_DATA_API_KEY || process.env.FOOTBALL_DATA_API_TOKEN || "";
  const requests = await Promise.allSettled([
    fetchJson(FIFA_PAGE_URL),
    fetchJson(FIFA_SEASON_URL),
    fetchJson(FIFA_MATCHES_URL),
    fetchJson(FIFA_NEWS_URL),
    footballToken
      ? fetchJson(FOOTBALL_DATA_MATCHES_URL, { headers: { "X-Auth-Token": footballToken } })
      : Promise.resolve(null)
  ]);

  const [pageResult, seasonResult, fifaResult, newsResult, footballResult] = requests;
  const fifaMatches = fifaResult.status === "fulfilled"
    ? ((fifaResult.value && fifaResult.value.Results) || []).map(normalizeFifaMatch).filter((match) => match.id && match.startsAt)
    : [];
  const footballMatches = footballResult.status === "fulfilled" && footballResult.value
    ? ((footballResult.value && footballResult.value.matches) || []).filter(isWorldCupMatch).map(normalizeFootballDataMatch).filter((match) => match.id && match.startsAt)
    : [];
  const matches = mergeMatches(fifaMatches, footballMatches).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

  if (!matches.length) {
    return res.status(502).json({ error: "worldcup_fetch_failed", message: "Neither FIFA nor Football-Data returned World Cup matches." });
  }

  const groupTables = standings(matches);
  const teamNames = new Set();
  matches.forEach((match) => [match.home, match.away].forEach((name) => {
    const value = String(name || "").trim();
    if (value && value.toUpperCase() !== "TBD") teamNames.add(value);
  }));
  const season = seasonResult.status === "fulfilled" ? seasonResult.value : null;
  const warnings = [];
  if (!footballToken) warnings.push("FOOTBALL_DATA_API_KEY is not configured; live score overlay is using FIFA only.");
  if (footballResult.status === "rejected") warnings.push("Football-Data request failed: " + footballResult.reason.message);
  if (footballToken && !footballMatches.length) warnings.push("Football-Data returned no World Cup matches for the current window or subscription.");
  if (fifaResult.status === "rejected") warnings.push("FIFA schedule request failed: " + fifaResult.reason.message);

  const payload = {
    updatedAt: new Date().toISOString(),
    season: {
      id: "285023",
      name: description(season && season.Name) || "FIFA World Cup 2026™",
      startDate: isoDate(season && season.StartDate) || "2026-06-11T19:00:00.000Z",
      endDate: isoDate(season && season.EndDate) || "2026-07-19T00:00:00.000Z"
    },
    stats: {
      teams: fifaMatches.length ? 48 : teamNames.size,
      matches: fifaMatches.length || matches.length,
      groups: groupTables.length
    },
    sources: {
      schedule: fifaMatches.length ? "FIFA" : "football-data.org",
      liveScores: footballMatches.length ? "football-data.org" : "FIFA",
      footballDataConfigured: Boolean(footballToken),
      footballDataMatches: footballMatches.length
    },
    warnings,
    hero: pageResult.status === "fulfilled" ? normalizeHero(pageResult.value) : null,
    matches,
    groups: groupTables,
    news: newsResult.status === "fulfilled" ? normalizeNews(newsResult.value) : []
  };

  cachedPayload = payload;
  cachedAt = Date.now();
  return res.status(200).json(payload);
};
