const crypto = require("node:crypto");

const ADMIN_PASSWORD_HASH = "0e4754d8d45ab2b704af086fe7c4728d442dda3851fb6b4a7ce9f3fb182f5c63";
const BUCKET_NAME = "skr-images";
const STORY_MANIFEST_PATH = "stories/manifest.json";
const STORY_META_PREFIX = "stories/meta";
const TABLE_NAME = "stories";
const MAX_PUBLIC_STORIES = 8;
const SKR_FALLBACK_SUPABASE_URL = "https://cfonxqjjpfjyvperqoee.supabase.co";
const SKR_FALLBACK_SUPABASE_ANON_KEY = "sb_publishable_lNRLpvRUqHbQQOFncDew6g_MqaoxW6M";

function setHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "").trim()).digest("hex");
}

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function createSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function getPublicBucketUrl(supabaseUrl, path) {
  const cleanPath = String(path || "").trim().replace(/^\/+/, "");
  return `${supabaseUrl}/storage/v1/object/public/${BUCKET_NAME}/${cleanPath}`;
}

function getStoryMetaPath(storyId) {
  return `${STORY_META_PREFIX}/${encodeURIComponent(String(storyId || "").trim())}.json`;
}

function normalizeStoryManifestEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const title = String(entry.title || entry.headline || "").trim();
  const id = String(entry.id || "").trim();
  if (!id || !title) return null;
  return {
    id,
    created_at: String(entry.created_at || entry.updated_at || new Date().toISOString()).trim(),
    title,
    excerpt: String(entry.excerpt || "").trim(),
    body: String(entry.body || entry.article_body || entry.content || "").trim(),
    category: String(entry.category || "Lifestyle").trim() || "Lifestyle",
    brand: String(entry.brand || "").trim(),
    image_url: String(entry.image_url || entry.image || entry.cover_image || entry.hero_image || "").trim(),
    slug: String(entry.slug || createSlug(title)).trim() || createSlug(title),
    content_type: String(entry.content_type || "article").trim().toLowerCase() === "video" ? "video" : "article",
    video_url: entry.video_url || null,
    video_duration: entry.video_duration == null ? null : Number(entry.video_duration) || null
  };
}

function buildStoryResponse(story, payload) {
  return {
    id: String(story && story.id || "").trim(),
    created_at: story && story.created_at ? story.created_at : new Date().toISOString(),
    title: payload.title,
    headline: payload.title,
    excerpt: payload.excerpt || "",
    body: payload.body || "",
    article_body: payload.body || "",
    content: payload.body || "",
    category: payload.category || "Lifestyle",
    brand: payload.brand || "",
    image_url: payload.image_url || "",
    image: payload.image_url || "",
    cover_image: payload.image_url || "",
    hero_image: payload.image_url || "",
    slug: payload.slug || createSlug(payload.title || ""),
    content_type: payload.content_type || "article",
    video_url: payload.video_url || null,
    video_duration: payload.video_duration == null ? null : payload.video_duration
  };
}

function buildCompatibleStoryPayload(payload, errorMessage) {
  const raw = String(errorMessage || "").toLowerCase();
  const nextPayload = Object.assign({}, payload);
  const missingColumns = [];
  const missingColumnPattern = /could not find the '([^']+)' column/g;
  let match = null;
  while ((match = missingColumnPattern.exec(raw))) {
    if (match[1]) missingColumns.push(match[1]);
  }
  missingColumns.forEach((column) => {
    delete nextPayload[column];
  });
  if (
    raw.includes("column stories.title does not exist")
    || raw.includes("column title does not exist")
    || missingColumns.includes("title")
  ) {
    nextPayload.headline = nextPayload.title;
    delete nextPayload.title;
  }
  if (raw.includes("column stories.body does not exist") || raw.includes("column body does not exist")) {
    delete nextPayload.body;
  }
  if (raw.includes("column stories.headline does not exist") || raw.includes("column headline does not exist")) {
    delete nextPayload.headline;
  }
  if (raw.includes("column stories.article_body does not exist") || raw.includes("column article_body does not exist")) {
    delete nextPayload.article_body;
  }
  if (raw.includes("column stories.content does not exist") || raw.includes("column content does not exist")) {
    delete nextPayload.content;
  }
  if (raw.includes("column stories.image does not exist") || raw.includes("column image does not exist")) {
    delete nextPayload.image;
  }
  if (raw.includes("column stories.cover_image does not exist") || raw.includes("column cover_image does not exist")) {
    delete nextPayload.cover_image;
  }
  if (raw.includes("column stories.hero_image does not exist") || raw.includes("column hero_image does not exist")) {
    delete nextPayload.hero_image;
  }
  if (raw.includes("column stories.slug does not exist") || raw.includes("column slug does not exist")) {
    delete nextPayload.slug;
  }
  if (raw.includes("column stories.video_url does not exist") || raw.includes("column video_url does not exist")) {
    delete nextPayload.video_url;
  }
  if (raw.includes("column stories.video_duration does not exist") || raw.includes("column video_duration does not exist")) {
    delete nextPayload.video_duration;
  }
  if (raw.includes("column stories.content_type does not exist") || raw.includes("column content_type does not exist")) {
    delete nextPayload.content_type;
  }
  return nextPayload;
}

async function supabaseRestInsert(supabaseUrl, serviceKey, payload) {
  let attemptPayload = Object.assign({}, payload);
  let lastError = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await fetch(`${supabaseUrl}/rest/v1/${TABLE_NAME}?select=*`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: "return=representation"
      },
      body: JSON.stringify(attemptPayload)
    });
    const json = await response.json().catch(() => ({}));
    if (response.ok) {
      return { ok: true, data: Array.isArray(json) ? json[0] || null : json, payload: attemptPayload };
    }
    lastError = json;
    const nextPayload = buildCompatibleStoryPayload(attemptPayload, JSON.stringify(json));
    if (JSON.stringify(nextPayload) === JSON.stringify(attemptPayload)) {
      break;
    }
    attemptPayload = nextPayload;
  }
  return { ok: false, error: lastError };
}

async function uploadStorageJson(supabaseUrl, serviceKey, path, value) {
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET_NAME}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "x-upsert": "true"
    },
    body: JSON.stringify(value)
  });
  if (response.ok) return { ok: true };
  const json = await response.json().catch(() => ({}));
  return { ok: false, error: json };
}

async function fetchManifest(supabaseUrl) {
  const response = await fetch(getPublicBucketUrl(supabaseUrl, STORY_MANIFEST_PATH), {
    cache: "no-store"
  }).catch(() => null);
  if (!response || !response.ok) return [];
  const json = await response.json().catch(() => ({}));
  return Array.isArray(json && json.stories) ? json.stories.map(normalizeStoryManifestEntry).filter(Boolean) : [];
}

module.exports = async function handler(req, res) {
  setHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "method_not_allowed" });

  const supabaseUrl =
    process.env.SKR_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    SKR_FALLBACK_SUPABASE_URL;
  const serviceKey =
    process.env.SKR_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SKR_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    SKR_FALLBACK_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey) {
    return json(res, 500, { ok: false, error: "missing_server_env", message: "Missing Supabase credentials." });
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const password = String(body.password || "").trim();
  if (!password || sha256(password) !== ADMIN_PASSWORD_HASH) {
    return json(res, 401, { ok: false, error: "unauthorized", message: "Admin authentication failed." });
  }

  const payload = body.payload && typeof body.payload === "object" ? body.payload : null;
  if (!payload || !String(payload.title || "").trim()) {
    return json(res, 400, { ok: false, error: "invalid_payload", message: "Missing story payload." });
  }

  const sourceStory = body.sourceStory && typeof body.sourceStory === "object" ? body.sourceStory : null;
  const insertResult = await supabaseRestInsert(supabaseUrl, serviceKey, payload);
  if (!insertResult.ok || !insertResult.data) {
    return json(res, 502, {
      ok: false,
      error: "supabase_insert_failed",
      message: "Supabase rejected the story publish.",
      details: insertResult.error || null
    });
  }

  const insertedStory = insertResult.data;
  const storyId = String(insertedStory.id || "").trim();
  const storyResponse = buildStoryResponse(insertedStory, payload);

  const meta = {
    id: storyId,
    title: storyResponse.title,
    excerpt: storyResponse.excerpt,
    body: storyResponse.body,
    category: storyResponse.category,
    brand: storyResponse.brand,
    slug: storyResponse.slug,
    content_type: storyResponse.content_type,
    video_url: storyResponse.video_url,
    video_duration: storyResponse.video_duration,
    image_url: storyResponse.image_url,
    updated_at: new Date().toISOString()
  };

  const metaResult = await uploadStorageJson(supabaseUrl, serviceKey, getStoryMetaPath(storyId), meta);
  if (!metaResult.ok) {
    return json(res, 502, { ok: false, error: "meta_upload_failed", message: "Story saved, but metadata upload failed.", details: metaResult.error || null });
  }

  const existingManifest = await fetchManifest(supabaseUrl);
  const manifestEntry = normalizeStoryManifestEntry({
    id: storyId,
    created_at: sourceStory && sourceStory.created_at ? sourceStory.created_at : insertedStory.created_at || new Date().toISOString(),
    title: storyResponse.title,
    excerpt: storyResponse.excerpt,
    body: storyResponse.body,
    category: storyResponse.category,
    brand: storyResponse.brand,
    image_url: storyResponse.image_url,
    slug: storyResponse.slug,
    content_type: storyResponse.content_type,
    video_url: storyResponse.video_url,
    video_duration: storyResponse.video_duration
  });
  const manifest = {
    updated_at: new Date().toISOString(),
    stories: [manifestEntry]
      .concat(existingManifest.filter((item) => String(item.id) !== String(manifestEntry.id)))
      .sort((left, right) => new Date(right.created_at || 0) - new Date(left.created_at || 0))
      .slice(0, MAX_PUBLIC_STORIES)
  };
  const manifestResult = await uploadStorageJson(supabaseUrl, serviceKey, STORY_MANIFEST_PATH, manifest);
  if (!manifestResult.ok) {
    return json(res, 502, { ok: false, error: "manifest_upload_failed", message: "Story saved, but manifest update failed.", details: manifestResult.error || null });
  }

  return json(res, 200, {
    ok: true,
    story: storyResponse
  });
};
