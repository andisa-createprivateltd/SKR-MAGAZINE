const ODDS_BASE_URL = "https://www.oddschecker.com/football/world-cup";
const MIRROR_PREFIX = "https://r.jina.ai/http://";
const CACHE_TTL_MS = 5 * 60 * 1000;
const oddsCache = new Map();

function setHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=300");
}

function normalizeTeamName(value) {
  const aliases = {
    "bosnia herzegovina": "bosnia and herzegovina",
    "cote d ivoire": "ivory coast",
    "cote divoire": "ivory coast",
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

function slugifyTeam(value) {
  const overrides = {
    "bosnia and herzegovina": "bosnia-and-herzegovina",
    "ivory coast": "ivory-coast",
    "south korea": "south-korea",
    "south africa": "south-africa",
    "saudi arabia": "saudi-arabia",
    usa: "usa"
  };
  const normalized = normalizeTeamName(value);
  return overrides[normalized] || normalized.replace(/\s+/g, "-");
}

function cacheKey(home, away, startsAt) {
  return [normalizeTeamName(home), normalizeTeamName(away), String(startsAt || "").slice(0, 10)].join("|");
}

function isMatchWindowEligible(startsAt) {
  const matchTime = Date.parse(String(startsAt || ""));
  if (Number.isNaN(matchTime)) return false;
  const diff = matchTime - Date.now();
  return diff > -12 * 60 * 60 * 1000 && diff < 45 * 24 * 60 * 60 * 1000;
}

function buildSourceUrl(home, away) {
  return ODDS_BASE_URL + "/" + slugifyTeam(home) + "-v-" + slugifyTeam(away) + "/winner";
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "text/plain,text/markdown,text/html;q=0.9,*/*;q=0.8"
    }
  });
  if (!response.ok) {
    throw new Error("Odds source returned " + response.status);
  }
  return response.text();
}

function parsePercent(value) {
  const match = String(value || "").trim().match(/^(\d+(?:\.\d+)?)%$/);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) ? number : null;
}

function parseWinMarket(markdown, home, away) {
  const normalizedHome = normalizeTeamName(home);
  const normalizedAway = normalizeTeamName(away);
  const lines = String(markdown || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const headingIndex = lines.findIndex((line) => /^##+\s+Win Market$/i.test(line));
  if (headingIndex === -1) return null;
  const pairs = [];
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const label = lines[index];
    if (/^##+\s+/.test(label) || /^Best Odds$/i.test(label)) break;
    const next = lines[index + 1];
    const percent = parsePercent(next);
    if (percent === null) continue;
    pairs.push({ label, percent });
    index += 1;
    if (pairs.length >= 3) break;
  }
  if (!pairs.length) return null;
  const drawEntry = pairs.find((entry) => normalizeTeamName(entry.label) === "draw") || null;
  const homeEntry = pairs.find((entry) => normalizeTeamName(entry.label) === normalizedHome) || null;
  const awayEntry = pairs.find((entry) => normalizeTeamName(entry.label) === normalizedAway) || null;
  const nonDrawEntries = pairs.filter((entry) => normalizeTeamName(entry.label) !== "draw");
  return {
    market: "Win Market",
    home: homeEntry ? homeEntry.percent : (nonDrawEntries[0] ? nonDrawEntries[0].percent : null),
    draw: drawEntry ? drawEntry.percent : null,
    away: awayEntry ? awayEntry.percent : (nonDrawEntries[1] ? nonDrawEntries[1].percent : null)
  };
}

module.exports = async function handler(req, res) {
  setHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  const home = String(req.query.home || "").trim();
  const away = String(req.query.away || "").trim();
  const startsAt = String(req.query.startsAt || "").trim();
  if (!home || !away) {
    return res.status(400).json({ error: "missing_match_teams" });
  }

  const sourceUrl = buildSourceUrl(home, away);
  const key = cacheKey(home, away, startsAt);
  const cached = oddsCache.get(key);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return res.status(200).json(cached.payload);
  }

  if (!isMatchWindowEligible(startsAt)) {
    const payload = {
      status: "scheduled",
      source: "Oddschecker",
      sourceUrl,
      checkedAt: new Date().toISOString(),
      market: "Win Market",
      home: null,
      draw: null,
      away: null
    };
    oddsCache.set(key, { cachedAt: Date.now(), payload });
    return res.status(200).json(payload);
  }

  try {
    const markdown = await fetchText(MIRROR_PREFIX + sourceUrl);
    const market = parseWinMarket(markdown, home, away);
    const payload = market
      ? {
          status: "ok",
          source: "Oddschecker",
          sourceUrl,
          checkedAt: new Date().toISOString(),
          market: market.market,
          home: market.home,
          draw: market.draw,
          away: market.away
        }
      : {
          status: "unavailable",
          source: "Oddschecker",
          sourceUrl,
          checkedAt: new Date().toISOString(),
          market: "Win Market",
          home: null,
          draw: null,
          away: null
        };
    oddsCache.set(key, { cachedAt: Date.now(), payload });
    return res.status(200).json(payload);
  } catch (error) {
    const payload = {
      status: "unavailable",
      source: "Oddschecker",
      sourceUrl,
      checkedAt: new Date().toISOString(),
      market: "Win Market",
      home: null,
      draw: null,
      away: null,
      error: String(error && error.message ? error.message : error || "odds_unavailable")
    };
    oddsCache.set(key, { cachedAt: Date.now(), payload });
    return res.status(200).json(payload);
  }
};
