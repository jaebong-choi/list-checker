# 국립국어원 사전 중계 서버 올리는 방법

검수기의 「국어사전 확인」 기능이 쓰는 작은 서버예요. 검수기가 보낸 **낱말 원형**(예: 수첩, 만들다)을
국립국어원 표준국어대사전·우리말샘에 대신 물어보고, 있는지 없는지만 돌려줘요.

- 인증키는 Cloudflare에만 저장되고 이 코드(GitHub)에는 들어가지 않아요.
- 검수기 사이트(jaebong-choi.github.io)에서 온 요청만 받아요.
- 같은 낱말은 30일 동안 다시 묻지 않아요.
- 무료 요금제(하루 10만 번 요청)로 충분해요.

## 1. 국립국어원 인증키 받기 (하나만 있어도 돼요, 둘 다 있으면 더 좋아요)

| 사전 | 신청하는 곳 | Cloudflare에 넣을 이름 |
|---|---|---|
| 표준국어대사전 | https://stdict.korean.go.kr → 로그인 → 오픈 API → 인증키 신청 | `STDICT_KEY` |
| 우리말샘 (새 말·전문어가 더 많음) | https://opendict.korean.go.kr → 로그인 → 오픈 API → 인증키 신청 | `OPENDICT_KEY` |

## 2. Cloudflare에 올리기 (프로그램 설치 없이, 웹 화면에서)

1. https://dash.cloudflare.com 에 무료로 가입하고 로그인해요.
2. 왼쪽 메뉴 **Workers & Pages** → **만들기(Create)** → **Worker 만들기(Create Worker)**.
3. 이름을 `nikl-relay` 로 정하고 **배포(Deploy)**.
4. **코드 편집(Edit code)** → 원래 있던 코드를 모두 지우고 이 폴더의 `worker.js` 내용을 그대로 붙여 넣은 뒤 **배포(Deploy)**.
5. Worker 화면의 **설정(Settings)** → **변수 및 비밀(Variables and Secrets)** → **추가(Add)**
   - 유형: **비밀(Secret)**, 이름: `STDICT_KEY`, 값: 표준국어대사전 인증키 → 저장
   - 우리말샘 키가 있으면 같은 방법으로 `OPENDICT_KEY` 도 추가
6. Worker 주소(예: `https://nikl-relay.○○○.workers.dev`)를 복사해요.
7. 브라우저 주소창에 `주소/health` 를 열어 `"ok":true` 가 나오면 성공이에요.
   (`"std":"err"` 처럼 나오면 키가 잘못됐거나 아직 승인 전이에요.)

## 3. 검수기에 연결

검수기 왼쪽 **「국어사전 확인」** 칸의 「중계 서버 주소」에 6번 주소를 붙여 넣으면 끝이에요.
(주소를 알려 주시면 검수기에 기본값으로 넣어 둘 수도 있어요.)

## 명령어로 올리는 방법 (Node.js가 있을 때)

```bash
npx wrangler login
npx wrangler deploy
npx wrangler secret put STDICT_KEY
npx wrangler secret put OPENDICT_KEY
```
