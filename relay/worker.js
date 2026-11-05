// 오타 및 계산 수정기 — 국립국어원 사전 중계 서버 (Cloudflare Workers)
// 검수기(브라우저)가 보낸 낱말 원형을 표준국어대사전·우리말샘 오픈 API에 대신 물어보고 결과만 돌려줌.
// 인증키는 Cloudflare 「변수 및 비밀」(STDICT_KEY, OPENDICT_KEY)에만 두고 코드에는 넣지 않음.

const ALLOW = ['https://jaebong-choi.github.io', 'http://localhost:8765']; // 이 주소에서 온 요청만 받음
const MAX_WORDS = 12;              // 한 번에 받는 낱말 수(무료 요금제의 요청당 외부 호출 50번 한도 안)
const CACHE_DAYS = 30;             // 같은 낱말은 30일 동안 다시 묻지 않음
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

// 사전 한 곳에 묻기 → true(있음) | false(없음) | 'err'(키 오류·서버 오류)
async function lookup(url){
  let res;
  try { res = await fetch(url, { headers: { 'accept': 'application/json' } }); } catch (e) { return 'err'; }
  if (!res.ok) return 'err';
  const t = (await res.text()).trim();
  if (!t) return false;                                   // 표준국어대사전은 결과가 없으면 빈 응답
  if (t.startsWith('<')) return /<error/i.test(t) ? 'err' : /<total>\s*[1-9]/.test(t);
  try {
    const j = JSON.parse(t);
    if (j.error) return 'err';
    return Number((j.channel || {}).total || 0) > 0;
  } catch (e) { return 'err'; }
}

// 낱말 하나 → 'std'(표준국어대사전에 있음) | 'open'(우리말샘에만 있음) | 'none'(둘 다 없음) | 'err'
async function check(word, env, ctx){
  const cache = caches.default, ck = new Request('https://nikl-cache.local/' + encodeURIComponent(word));
  const hit = await cache.match(ck);
  if (hit) return await hit.text();
  let out = 'none';
  if (env.STDICT_KEY) { const r = await lookup(STD(env.STDICT_KEY, word)); if (r === 'err') out = 'err'; else if (r) out = 'std'; }
  if (out !== 'std' && env.OPENDICT_KEY) { const r = await lookup(OPEN(env.OPENDICT_KEY, word)); if (r === true) out = 'open'; else if (r === 'err' && out === 'none' && !env.STDICT_KEY) out = 'err'; }
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
      return json({ ok: std === true || open === true, std, open }, 200, origin);
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
