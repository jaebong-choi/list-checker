// 오타 및 계산 수정기 — 국립국어원 사전 중계 서버 (Cloudflare Workers)
// 검수기(브라우저)가 보낸 낱말 원형을 표준국어대사전·우리말샘 오픈 API에 대신 물어보고 결과만 돌려줌.
// 인증키는 Cloudflare 「변수 및 비밀」(STDICT_KEY, OPENDICT_KEY)에만 두고 코드에는 넣지 않음.
// 결과: 'std'(표준국어대사전에 있음) | 'open'(우리말샘에만 있음) | 'none'(없음) | 'wrong:맞는말'(사전에 "'맞는말'의 잘못"으로 실림) | 'err'

const ALLOW = ['https://jaebong-choi.github.io', 'http://localhost:8765']; // 이 주소에서 온 요청만 받음
const MAX_WORDS = 10;              // 한 번에 받는 낱말 수(무료 요금제의 요청당 외부 호출 50번 한도 안)
const CACHE_DAYS = 30;             // 같은 낱말은 30일 동안 다시 묻지 않음
const CACHE_VER = 'v4';           // 결과 형식이 바뀌면 올려서 예전 기억을 버림(v4: 빈 응답을 '없음'으로 잘못 기억한 것 버림)
const WORD = /^[가-힣]{1,20}$/;    // 한글 낱말만(이름·숫자·영어는 받지 않음)

const STD = (key, w) => `https://stdict.korean.go.kr/api/search.do?key=${key}&q=${encodeURIComponent(w)}&req_type=json&advanced=y&method=exact&num=10`;
const OPEN = (key, w) => `https://opendict.korean.go.kr/api/search?key=${key}&q=${encodeURIComponent(w)}&req_type=json&advanced=y&method=exact&num=10`;

function cors(origin){
  return {
    'Access-Control-Allow-Origin': ALLOW.includes(origin) ? origin : ALLOW[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
const json = (obj, status, origin) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors(origin) } });

// 뜻풀이가 모두 "'역할'의 잘못"처럼 틀린 말 안내면 맞는 말을 돌려줌
function wrongOf(t){
  const defs = [...t.matchAll(/"definition"\s*:\s*"((?:[^"\\]|\\.)*)"|<definition>([\s\S]*?)<\/definition>/g)].map(m => (m[1] ?? m[2] ?? '').replace(/<[^>]+>|\\u[0-9a-f]{4}/gi, ''));
  if (!defs.length) return null;
  // 표준국어대사전은 틀린 말을 "→ 역할."(화살표)로, 우리말샘은 "'역할'의 잘못"으로 적음
  const to = defs.map(d => (d.match(/^\s*→\s*([가-힣][가-힣^\- ]*)/) || d.match(/^\s*[‘'"「]?([가-힣 ]+?)[’'"」]?\s*의\s*(잘못|비표준어)/) || [])[1]);
  return to.every(Boolean) ? to[0].replace(/\^/g, ' ').replace(/-/g, '').trim() : null; // 사전 표기: ^ = 띄어 쓸 수 있음, - = 낱말 경계
}
// 사전 한 곳에 묻기 → true(있음) | false(없음) | 'wrong:맞는말' | 'err'(키 오류·서버 오류)
// 표준국어대사전은 결과가 없을 때도, 잠깐 몰려서 못 답할 때도 빈 응답을 줌 → 빈 응답이면 조금 기다렸다 한 번 더 물어봄
// (무료 요금제는 요청 하나에 외부 호출 50번까지라 낱말 10개 × 2번으로 맞춤)
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function lookup(url){
  let t = '';
  for (const wait of [0, 900]) {
    if (wait) await sleep(wait);
    let res;
    try { res = await fetch(url, { headers: { 'accept': 'application/json' } }); } catch (e) { return 'err'; }
    if (!res.ok) return 'err';
    t = (await res.text()).trim();
    if (t) break;
  }
  if (!t) return false;                                   // 두 번 다 비어 있으면 결과 없음으로 봄
  let found;
  if (t.startsWith('<')) { if (/<error/i.test(t)) return 'err'; found = /<total>\s*[1-9]/.test(t); }
  else { try { const j = JSON.parse(t); if (j.error) return 'err'; found = Number((j.channel || {}).total || 0) > 0; } catch (e) { return 'err'; } }
  if (!found) return false;
  const w = wrongOf(t);
  return w ? 'wrong:' + w : true;
}

async function check(word, env, ctx){
  const cache = caches.default, ck = new Request(`https://nikl-cache.local/${CACHE_VER}/` + encodeURIComponent(word));
  const hit = await cache.match(ck);
  if (hit) return await hit.text();
  let out = 'none';
  if (env.STDICT_KEY) { const r = await lookup(STD(env.STDICT_KEY, word)); if (r === 'err') out = 'err'; else if (r === true) out = 'std'; else if (r) out = r; }
  if (out === 'none' && env.OPENDICT_KEY) { const r = await lookup(OPEN(env.OPENDICT_KEY, word)); if (r === true) out = 'open'; else if (typeof r === 'string' && r.startsWith('wrong:')) out = r; }
  else if (out === 'err' && env.OPENDICT_KEY) { const r = await lookup(OPEN(env.OPENDICT_KEY, word)); if (r === true) out = 'open'; else if (r === false) out = 'none'; }
  if (out !== 'err') ctx.waitUntil(cache.put(ck, new Response(out, { headers: { 'Cache-Control': `max-age=${CACHE_DAYS * 86400}` } })));
  return out;
}

export default {
  async fetch(req, env, ctx){
    const origin = req.headers.get('Origin') || '';
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (origin && !ALLOW.includes(origin)) return json({ error: '허용되지 않은 사이트에서 온 요청이에요.' }, 403, origin);
    if (!env.STDICT_KEY && !env.OPENDICT_KEY) return json({ error: '중계 서버에 국립국어원 인증키가 없어요(STDICT_KEY 또는 OPENDICT_KEY).' }, 500, origin);

    // 상태 확인: 「나무」를 찾아 키가 제대로 동작하는지 봄
    if (url.pathname === '/health') {
      const std = env.STDICT_KEY ? await lookup(STD(env.STDICT_KEY, '나무')) : 'nokey';
      const open = env.OPENDICT_KEY ? await lookup(OPEN(env.OPENDICT_KEY, '나무')) : 'nokey';
      return json({ ok: std === true || open === true, std, open, max: MAX_WORDS, v: CACHE_VER }, 200, origin);
    }

    if (url.pathname === '/check' && req.method === 'POST') {
      if (!ALLOW.includes(origin)) return json({ error: '검수기 사이트에서만 쓸 수 있어요.' }, 403, origin); // 다른 곳에서 키를 가져다 쓰지 못하게
      let body; try { body = await req.json(); } catch (e) { return json({ error: '요청 형식이 잘못됐어요.' }, 400, origin); }
      const words = [...new Set((body.words || []).filter(w => typeof w === 'string' && WORD.test(w)))].slice(0, MAX_WORDS);
      const results = {};
      for (const w of words) results[w] = await check(w, env, ctx); // 차례로 물어 국립국어원 서버에 부담을 줄임
      return json({ results }, 200, origin);
    }
    return json({ error: '없는 주소예요. /check 또는 /health 를 써 주세요.' }, 404, origin);
  }
};
