// src/core/sunoParser.ts
var UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
var SHORT_RE = /suno\.com\/s\/([A-Za-z0-9_-]+)/i;
var HOOK_RE = /suno\.com\/hook\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
var HOOK_API = "https://studio-api-prod.suno.com/api/video/hooks/";
var DEFAULT_PROXY = "https://sunoapi.aibiei.com/proxy?url=";
function extractId(raw) {
  const str = String(raw || "").trim();
  const h = str.match(HOOK_RE);
  if (h) return "h:" + h[1].toLowerCase();
  const m = str.match(UUID_RE);
  if (m) return m[0].toLowerCase();
  const s = str.match(SHORT_RE);
  if (s) return "s:" + s[1];
  return "";
}
function collectPayload(html) {
  const re = /self\.__next_f\.push\(\[\s*1\s*,\s*"((?:\\.|[^"\\])*)"\s*\]\)/g;
  let out = "";
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      out += JSON.parse('"' + m[1] + '"');
    } catch {
      out += m[1].replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "	").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
  }
  return out;
}
function readNBytes(s, start, byteLen) {
  let got = 0;
  let i = start;
  while (i < s.length && got < byteLen) {
    const code = s.charCodeAt(i);
    let step = 1;
    let bytes;
    if (code < 128) bytes = 1;
    else if (code < 2048) bytes = 2;
    else if (code >= 55296 && code <= 56319) {
      bytes = 4;
      step = 2;
    } else bytes = 3;
    got += bytes;
    i += step;
  }
  return { text: s.substring(start, i), nextCharIdx: i };
}
function readJsonValue(s, start) {
  let i = start;
  while (i < s.length && /\s/.test(s.charAt(i))) i++;
  if (i >= s.length) return null;
  const c = s.charAt(i);
  if (c === '"') {
    let j = i + 1;
    while (j < s.length) {
      const ch = s.charAt(j);
      if (ch === "\\") {
        j += 2;
        continue;
      }
      if (ch === '"') {
        j++;
        break;
      }
      j++;
    }
    return { raw: s.substring(i, j), end: j };
  }
  if (c === "{" || c === "[") {
    const stack = [c];
    let k = i + 1;
    while (k < s.length && stack.length) {
      const cc = s.charAt(k);
      if (cc === '"') {
        while (k < s.length) {
          if (s.charAt(k) === "\\") {
            k += 2;
            continue;
          }
          if (s.charAt(k) === '"') {
            k++;
            break;
          }
          k++;
        }
        continue;
      }
      if (cc === "{" || cc === "[") stack.push(cc);
      else if (cc === "}" || cc === "]") stack.pop();
      k++;
    }
    return { raw: s.substring(i, k), end: k };
  }
  const scalar = /^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(s.substring(i));
  if (scalar) return { raw: scalar[0], end: i + scalar[0].length };
  return null;
}
function parseFlight(payload) {
  const map = /* @__PURE__ */ new Map();
  let i = 0;
  const n = payload.length;
  while (i < n) {
    let j = i;
    while (j < n && /[0-9a-f]/i.test(payload.charAt(j))) j++;
    if (j === i || payload.charAt(j) !== ":") {
      i = j + 1;
      continue;
    }
    const id = payload.substring(i, j).toLowerCase();
    const k = j + 1;
    const typeCh = payload.charAt(k);
    if (typeCh === "T") {
      const hexStart = k + 1;
      let m = hexStart;
      while (m < n && /[0-9a-f]/i.test(payload.charAt(m))) m++;
      if (payload.charAt(m) !== ",") {
        i = m + 1;
        continue;
      }
      const byteLen = parseInt(payload.substring(hexStart, m), 16);
      const got = readNBytes(payload, m + 1, byteLen);
      map.set(id, { type: "T", value: got.text });
      i = got.nextCharIdx;
      if (payload.charAt(i) === "\n") i++;
      continue;
    }
    if (typeCh === "I" || typeCh === "H" || typeCh === "M" || typeCh === "J" || typeCh === "L") {
      const v = readJsonValue(payload, k + 1);
      if (v) {
        let parsed;
        try {
          parsed = JSON.parse(v.raw);
        } catch {
          parsed = v.raw;
        }
        map.set(id, { type: typeCh, value: parsed });
        i = v.end;
        if (payload.charAt(i) === "\n") i++;
        continue;
      }
      i = k + 2;
      continue;
    }
    const v2 = readJsonValue(payload, k);
    if (v2) {
      let parsed2;
      try {
        parsed2 = JSON.parse(v2.raw);
      } catch {
        parsed2 = v2.raw;
      }
      map.set(id, { value: parsed2 });
      i = v2.end;
      if (payload.charAt(i) === "\n") i++;
      continue;
    }
    i = k + 1;
  }
  return map;
}
function deref(node, map, seen, depth) {
  if (depth > 40) return node;
  if (node == null) return node;
  if (typeof node === "string") {
    const m = /^\$[LSH]?([0-9a-f]+)$/i.exec(node);
    if (!m) return node;
    const key = m[1].toLowerCase();
    if (seen.has(key)) return node;
    const entry = map.get(key);
    if (!entry) return node;
    seen.add(key);
    const out = deref(entry.value, map, seen, depth + 1);
    seen.delete(key);
    return out;
  }
  if (Array.isArray(node)) {
    return node.map((x) => deref(x, map, seen, depth + 1));
  }
  if (typeof node === "object") {
    const o = {};
    for (const k of Object.keys(node)) {
      o[k] = deref(node[k], map, seen, depth + 1);
    }
    return o;
  }
  return node;
}
function findClip(val, targetId) {
  if (!val || typeof val !== "object") return null;
  if (Array.isArray(val)) {
    for (const x of val) {
      const r = findClip(x, targetId);
      if (r) return r;
    }
    return null;
  }
  const v = val;
  if (v.clip && typeof v.clip === "object" && v.clip.id) {
    const c = v.clip;
    if (!targetId || String(c.id).toLowerCase() === targetId.toLowerCase()) {
      return c;
    }
  }
  for (const k of Object.keys(v)) {
    const r = findClip(v[k], targetId);
    if (r) return r;
  }
  return null;
}
function fallbackFromHtml(html, id) {
  let title = "";
  let handle = "";
  const mt = html.match(/<title>([^<]*)<\/title>/i);
  if (mt) {
    const t = mt[1];
    const h = t.match(/^(.*) by @([^\s|]+)\s*\|\s*Suno$/);
    if (h) {
      title = h[1].trim();
      handle = h[2].trim();
    } else {
      title = t.replace(/\|\s*Suno\s*$/, "").trim();
    }
  }
  return {
    id,
    title: title || id,
    handle,
    display_name: handle,
    image_url: "https://cdn2.suno.ai/image_" + id + ".jpeg",
    audio_url: "https://cdn1.suno.ai/" + id + ".mp3",
    video_url: "",
    metadata: { tags: "", prompt: "", duration: null },
    _fallback: true
  };
}
function parseHtml(html, id) {
  if (!html) return fallbackFromHtml("", id);
  const payload = collectPayload(html);
  if (!payload) return fallbackFromHtml(html, id);
  const map = parseFlight(payload);
  const resolved = {};
  map.forEach((entry, k) => {
    resolved[k] = deref(entry.value, map, /* @__PURE__ */ new Set(), 0);
  });
  let clip = null;
  for (const k of Object.keys(resolved)) {
    clip = findClip(resolved[k], id);
    if (clip) break;
  }
  if (!clip) {
    for (const k of Object.keys(resolved)) {
      clip = findClip(resolved[k]);
      if (clip) break;
    }
  }
  if (!clip) return fallbackFromHtml(html, id);
  clip.id = clip.id || id;
  if (!clip.audio_url) clip.audio_url = "https://cdn1.suno.ai/" + clip.id + ".mp3";
  if (!clip.image_url) clip.image_url = "https://cdn2.suno.ai/image_" + clip.id + ".jpeg";
  return clip;
}
function normalizeHook(data, hookId) {
  if (!data || typeof data !== "object") return null;
  const d = data;
  const clip = d.clip && typeof d.clip === "object" ? d.clip : {};
  const originalId = clip.id || d.original_clip_id || "";
  const videoUrl = typeof d.rendered_video_url === "string" ? d.rendered_video_url : "";
  if (!originalId || !videoUrl || !/^https:\/\//i.test(videoUrl)) return null;
  const normalized = { ...clip };
  normalized.id = originalId;
  normalized.title = clip.title || d.title || "Suno hook";
  normalized.audio_url = clip.audio_url || "https://cdn1.suno.ai/" + originalId + ".mp3";
  normalized.video_url = videoUrl;
  normalized.image_url = d.thumbnail_image_url || clip.image_url || "https://cdn2.suno.ai/image_" + originalId + ".jpeg";
  normalized.hook_id = d.id || hookId;
  normalized.hook_duration = d.video_duration != null ? Number(d.video_duration) : null;
  normalized.hook_caption = typeof d.caption === "string" ? d.caption : "";
  normalized._hook = true;
  return normalized;
}
async function fetchHookById(hookId, fetchPage, signal) {
  try {
    const text = await fetchPage(HOOK_API + hookId, signal);
    const data = JSON.parse(text);
    return normalizeHook(data, hookId);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    return null;
  }
}
async function fetchAndParse(id, fetchPage, signal) {
  const isHook = id.indexOf("h:") === 0;
  const isShort = id.startsWith("s:");
  if (isHook) {
    const directHook = await fetchHookById(id.slice(2), fetchPage, signal);
    if (!directHook) throw new Error("\u65E0\u6CD5\u52A0\u8F7D\u516C\u5F00 Hook \u8BE6\u60C5");
    return directHook;
  }
  const target = isShort ? "https://suno.com/s/" + id.slice(2) : "https://suno.com/song/" + id;
  const html = await fetchPage(target, signal);
  if (!html || html.length < 400) throw new Error("\u4EE3\u7406\u8FD4\u56DE\u4E3A\u7A7A");
  let realId = id;
  if (isShort) {
    const hookMatch = html.match(HOOK_RE);
    realId = (hookMatch ? hookMatch[1] : (html.match(UUID_RE) || [""])[0]).toLowerCase();
    if (!realId) throw new Error("\u65E0\u6CD5\u5C06\u77ED\u94FE\u63A5\u89E3\u6790\u4E3A\u6B4C\u66F2 ID");
    if (hookMatch) {
      const shortHook = await fetchHookById(realId, fetchPage, signal);
      if (shortHook) return shortHook;
    }
  }
  return parseHtml(html, realId);
}
function findAllClips(val, collected, seen) {
  if (!val || typeof val !== "object") return;
  if (Array.isArray(val)) {
    for (const x of val) findAllClips(x, collected, seen);
    return;
  }
  const v = val;
  if (v.clip && typeof v.clip === "object" && v.clip.id) {
    const c = v.clip;
    if (!seen.has(c.id)) {
      seen.add(c.id);
      collected.push(c);
    }
  }
  for (const k of Object.keys(v)) findAllClips(v[k], collected, seen);
}
function findPlaylistImage(resolved) {
  let best = "";
  for (const k of Object.keys(resolved)) {
    const v = resolved[k];
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const vv = v;
    const img = vv.image_url || vv.imageUrl || "";
    if (typeof img !== "string" || !/cdn[12]\.suno\.ai/i.test(img)) continue;
    let count = 0;
    for (const kk of Object.keys(vv)) {
      const c = vv[kk];
      if (c && typeof c === "object" && c.clip && c.clip.id) count++;
    }
    if (count >= 2 || Array.isArray(vv.clips) && vv.clips.length >= 2) {
      best = img;
      break;
    }
  }
  return best;
}
function findPlaylistName(resolved, html) {
  let name = "";
  const mt = html.match(/<title>([^<]*)<\/title>/i);
  if (mt) name = mt[1].replace(/\s*\|\s*Suno\s*$/i, "").trim();
  if (name) return name;
  for (const k of Object.keys(resolved)) {
    const v = resolved[k];
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const vv = v;
    if (typeof vv.name === "string" && vv.name) {
      let count = 0;
      for (const kk of Object.keys(vv)) {
        const c = vv[kk];
        if (c && typeof c === "object" && c.clip && c.clip.id) count++;
      }
      if (count >= 2 || Array.isArray(vv.clips)) return vv.name;
    }
    if (typeof vv.title === "string" && vv.title) {
      let c2 = 0;
      for (const kk of Object.keys(vv)) {
        const c = vv[kk];
        if (c && typeof c === "object" && c.clip && c.clip.id) c2++;
      }
      if (c2 >= 2 || Array.isArray(vv.clips)) return vv.title;
    }
  }
  return name;
}
function parsePlaylistHtml(html, id) {
  const payload = collectPayload(html);
  const resolved = {};
  if (payload) {
    const map = parseFlight(payload);
    map.forEach((entry, k) => {
      resolved[k] = deref(entry.value, map, /* @__PURE__ */ new Set(), 0);
    });
  }
  const clips = [];
  findAllClips(resolved, clips, /* @__PURE__ */ new Set());
  clips.forEach((c) => {
    c.id = c.id || "";
    if (!c.audio_url) c.audio_url = "https://cdn1.suno.ai/" + c.id + ".mp3";
    if (!c.image_url) c.image_url = "https://cdn2.suno.ai/image_" + c.id + ".jpeg";
  });
  const name = findPlaylistName(resolved, html) || "Playlist " + String(id).substring(0, 8);
  const image = findPlaylistImage(resolved);
  return { clips, name, image };
}
async function fetchAndParsePlaylist(id, fetchPage, signal) {
  const target = "https://suno.com/playlist/" + id;
  const html = await fetchPage(target, signal);
  if (!html || html.length < 400) throw new Error("\u4EE3\u7406\u8FD4\u56DE\u4E3A\u7A7A");
  return parsePlaylistHtml(html, id);
}
export {
  DEFAULT_PROXY,
  extractId,
  fetchAndParse,
  fetchAndParsePlaylist,
  parseHtml,
  parsePlaylistHtml
};
