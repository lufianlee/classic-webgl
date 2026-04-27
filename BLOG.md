# 클래식 음악을 공간으로 걷는 WebGL 경험을 하루 만에 만들어봤다

> *"음악을 듣는 것이 아니라, 공간으로 걷는다."*

클래식 한 곡을 고를 때 내 머릿속에 먼저 그려지는 건 음표가 아니라 **그 음악이 울리는 공간**이다. 바흐의 토카타는 대성당 천장, 쇼팽의 녹턴은 촛불 켜진 살롱, 브람스의 피아노 협주곡은 반질반질한 파케이를 깔아놓은 19세기 콘서트홀. 이 연결을 웹에서 걸어다닐 수 있게 만들면 재밌겠다 싶어서, **AI 페어 프로그래밍**으로 하루 만에 밀어붙여 봤다.

이 글은 그 과정에서 내가 내린 결정, 마주친 실패, 그리고 얻은 교훈을 정리한 기록이다.

---

## 1. 전체 그림

```
┌─────────────────────────────┐   audio URL or file   ┌────────────────────────┐
│ Next.js 14 + R3F            │ ────────────────────▶ │ FastAPI + librosa      │
│  · WebGL 3D spaces          │                       │  · BPM / key / chroma  │
│  · Web Audio (analyser,     │ ◀──── JSON digest ─── │  · per-band envelopes  │
│    panner, convolver)       │                       │  · file cache          │
│  · real-time chroma / BPM   │                       │                        │
│  · LLM commentary ticker    │ ◀── /api/commentary   │  · Bedrock Sonnet 4.6  │
└─────────────────────────────┘                       └────────────────────────┘
            :3000                                                :8000
```

내가 선택한 스택:
- **Frontend**: Next.js 14 (App Router), React Three Fiber, TypeScript, Tailwind, Zustand, `@react-three/postprocessing`
- **Backend**: FastAPI, librosa, numpy, httpx, uvicorn
- **LLM**: Amazon Bedrock(Claude Sonnet 4.6), Anthropic Messages, OpenAI Chat Completions — 세 곳 다 붙여두고 사용자가 고를 수 있게
- **PBR 텍스처**: Poly Haven CC0 (Docker 빌드 시 다운받아서 이미지에 내장)
- **인프라**: Docker Compose → AWS Elastic Beanstalk(Multi-container Docker) + ECR

---

## 2. 분석 파이프라인 — 서버의 "전곡 지도" + 브라우저의 "라이브 컨덕터"

클래식은 한 곡 안에서 조가 몇 번씩 바뀌고 템포가 수시로 흔들린다. "C major, 120 bpm" 라벨 하나로는 곡의 생명을 다 담지 못한다고 판단해서, 두 층의 분석을 붙였다.

### 2.1 서버 — librosa로 한 번에 전곡

음원이 들어오면 librosa가 곡 전체를 분석한다:

```python
# backend/app/analysis.py — 핵심 요약
y, sr = librosa.load(path, sr=22050, mono=True)
tempo, beats   = librosa.beat.beat_track(y=y, sr=sr)
chroma         = librosa.feature.chroma_cqt(y=y, sr=sr)
mel            = librosa.feature.melspectrogram(y=y, sr=sr, n_mels=64)
```

키 추정은 **Krumhansl–Kessler profile**을 평균 chroma에 상관계수로 매기는 방식을 썼다. 하프시코드처럼 배음이 복잡한 악기는 STFT chroma보다 **CQT chroma**가 훨씬 깔끔해서 그걸 골랐다. Bass / mid / treble 대역별 에너지 envelope도 뽑아서 500 프레임으로 다운샘플링해뒀다. 결과는 파일 해시 키로 디스크에 캐시해두니 같은 URL을 두 번 분석할 일이 없다.

### 2.2 브라우저 — 매 프레임 FFT, 실시간

서버 분석은 "곡 전체의 평균"이라 변화를 보여주지 못한다. 그래서 브라우저에서 같은 곡을 또 **실시간으로** 분석한다:

```ts
// frontend/src/lib/realtime.ts
// 매 프레임 FFT → 12-bin chroma → Krumhansl correlation
for (let i = 0; i < freqData.length; i++) {
  const f = binFreqs[i];
  if (f < 65 || f > 2100) continue;          // tonal 영역만
  const midi = 69 + 12 * Math.log2(f / 440);
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  chroma[pc] += mag * mag;                   // 강한 피크가 지배하도록 제곱
}
```

여기서 제일 중요하게 쓴 기술은 **히스테리시스**다. 새 조 후보가 1초 이상 최상위로 유지될 때만 실제 표시 키를 교체하도록 했다. 안 그러면 장조↔단조 사이를 계속 깜빡거려서 보는 사람 눈이 피로해진다. 템포는 spectral flux onset으로 IOI를 모으고 중앙값의 60배를 현재 BPM으로 썼다.

HUD에 12-bin chroma 막대그래프를 올려두니, 조바꿈이 일어날 때 금색 강조가 옆 막대로 스르륵 옮겨가는 게 눈에 보인다. 이 피드백이 의외로 중독성이 있어서 한참 멍 때리며 봤다.

---

## 3. WebGL 공간 — 욕심 vs. 현실

처음엔 크게 욕심을 냈다. Freepik에서 대성당 내부 사진을 보여주며 "이 퀄리티로 해줘" 라고 요청했다. 그러자 AI가 정직하게 이렇게 답했다:

> 사진급 퀄리티는 현재 접근법으로 불가능합니다. 파라메트릭 박스/실린더로는 photogrammetry 모델을 못 이깁니다. 세 가지 길이 있는데… (HDRI / glTF / PBR)

세 옵션의 장단점을 비교해보고 나는 **B안(PBR 텍스처, 자유 보행 유지)** 을 골랐다. HDRI는 사진 같은 느낌이지만 걸어다닐 수 없다는 게 치명적이었고, glTF는 CC 라이선스 확인·파일 크기·로딩 시간 부담이 너무 컸다. "대체로 그럴듯하면서 음악 체험을 위한 최소한의 해상도"라는 타협점이 B안이었다.

### 3.1 공간별 전용 컴포넌트

`Cathedral.tsx`, `ConcertHall.tsx`, `Salon.tsx` 세 파일. 각자 완전히 다른 실루엣을 갖도록 분리했다:

| 공간 | 특징 | 조명 | 음향 |
|---|---|---|---|
| Cathedral | 60 m 네이브, pointed arch, 다발기둥, rose window, 3단 제단+baldachin+십자가 | clerestory daylight + 촛불 + 제단 key light | RT60 5.2 s |
| Concert Hall | Shoebox, coffered 천장, 양쪽 발코니, stage shell, 그랜드 피아노 | 샹들리에 + 스테이지 spot | RT60 2.0 s |
| Salon | 14×16m, wainscot + 금 몰딩, 천장 beam, 그랜드 피아노, 사중주 의자, 거울, candelabra | candlelight 2점 + ambient | RT60 0.7 s |

### 3.2 PBR 텍스처 적용

`usePBRMaterial` 훅이 Poly Haven의 diffuse + normal + roughness 3장을 받아 `MeshStandardMaterial`을 만든다:

```ts
diff.colorSpace   = THREE.SRGBColorSpace;
normal.colorSpace = THREE.NoColorSpace;
rough.colorSpace  = THREE.NoColorSpace;
for (const t of [diff, normal, rough]) {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;   // 바닥을 스쳐보는 각에서 뭉개지지 않게
}
```

`scripts/fetch-textures.sh`로 Docker 빌드 시 Poly Haven에서 텍스처를 받아 `public/textures/`에 내장되게 했다. 15개 JPG, 합쳐도 9 MB 안 됨. 이걸 리포지토리에 직접 커밋할지, 매번 빌드 때 받을지 고민했는데 양도 작고 CC0라서 그냥 커밋했다.

### 3.3 포스트프로세싱

```tsx
<EffectComposer multisampling={0}>
  <Bloom intensity={0.55–0.9} luminanceThreshold={0.5} mipmapBlur />
  <Vignette offset={0.15} darkness={0.85} />
  <SMAA />
</EffectComposer>
```

거기에 ACES Filmic tone mapping. 제단 금색 몰딩과 스테인드글라스 emissive가 Bloom으로 번지면서 "촛불 든 성당" 느낌이 드디어 살아났다. 이 한 줄을 추가하기 전과 후가 씬의 분위기가 완전히 다르다.

---

## 4. 3D 공간 음향 — 돌아다니면 소리가 달라지는 이유

처음 구현이 끝난 뒤 내가 물었다:
> 거리에 따라 소리가 다르게 들리게 구현되어 있어?

정직한 답이 돌아왔다: "아니오, 지금은 스테레오 평면입니다." 그리고 바로 고치기 시작했다.

### 4.1 신호 경로를 다시 짰다

```
source ┬─▶ analyser                        (분석용 silent 브랜치)
       ├─▶ dryGain ─▶ panner (HRTF, 거리) ──┐
       └─▶ convolver ─▶ wetGain ────────────┤
                                            ▼
                                   destinationGain ─▶ out
```

핵심 설계 결정: **dry 신호만 PannerNode를 통과**시키고, wet(리버브)은 위치 무관하게 전체에 퍼지도록 했다. 실제 공간에서 반사음은 "어디서 들어도 방 전체에서 오니까" 이게 맞다.

### 4.2 공간마다 IR을 새로 만들었다

첫 구현을 듣고 내가 말했다: "공간 바꿔도 차이가 안 느껴지는데?" 원인은 세 가지가 동시에 있었다:

1. IR을 전부 RMS 0.05로 정규화해놔서 — 대성당이 오히려 조용해지는 역설
2. 단순 `노이즈 × 지수감쇠`라 "어떤 공간인지" 힌트가 부족
3. dry/wet 비율 차이(0.55 vs 0.12)가 너무 미묘

세 개를 한꺼번에 고쳤다. **정규화 제거, early reflection 클러스터 추가, HF rolloff 추가, dry/wet 비율 강화**:

```ts
const SPACE_ACOUSTICS = {
  cathedral:    { rt60: 5.2, preDelay: 0.085, earlyReflections: [0.095, 0.13, 0.18, 0.24, 0.31, 0.42], hfRolloffHz: 3500, stereoSpread: 0.85 },
  concert_hall: { rt60: 2.0, preDelay: 0.028, earlyReflections: [0.035, 0.055, 0.078, 0.1, 0.13], hfRolloffHz: 6000, stereoSpread: 0.55 },
  salon:        { rt60: 0.7, preDelay: 0.009, earlyReflections: [0.014, 0.021, 0.03, 0.042], hfRolloffHz: 7500, stereoSpread: 0.3 },
};
```

성당은 RT60 5.2초, 공기 흡수로 3.5 kHz 위가 더 빨리 감쇠하는 "따뜻한" 톤. 살롱은 0.7초짜리 짧은 꼬리에 7.5 kHz까지 살아있는 "선명한" 톤. 한 번 들어보고 "이거지!" 했다.

dry/wet 게인은 "Cathedral wet 1.6 / dry 0.55"와 "Salon wet 0.35 / dry 1.0"으로 공간감 차이를 증폭시켰고, 전환할 땐 250 ms 크로스페이드로 클릭 소리를 제거했다.

### 4.3 음원 위치 + 보행 연동

각 공간에 음원이 있는 자리를 명시했다. 성당은 제단(-22z), 홀은 무대(-14z), 살롱은 그랜드 피아노(-1,-1). `WalkControls`가 매 프레임 listener 위치/방향을 update하니 걸어가면 거리와 HRTF가 실시간 반영된다. 성당에서 제단 앞까지 걸어가면 소리가 커지면서 좌우가 살짝 바뀌는 게 느껴진다.

---

## 5. LLM 해설 — 재생 시간에 동기화되는 구간별 비평

옵션으로 켜면 LLM이 곡을 분석해 해설해주면 좋겠다고 생각했다. 기본은 **Bedrock Sonnet 4.6**, 사용자가 모델 ID를 파라미터로 바꿀 수 있게. 키는 로컬 PC의 `AWS_BEARER_TOKEN_BEDROCK` 환경변수를 사용하고, Anthropic이나 OpenAI를 쓰고 싶으면 브라우저에서 키를 직접 입력할 수 있게 만들었다.

### 5.1 프롬프트 디자인

전곡 feature 시계열을 그대로 보내면 토큰이 너무 커지길래, `_compress_features`가 64×500 스펙트로그램을 16개 time window로 압축하도록 했다:

```json
{
  "duration": 6.36, "tempo": 83.4, "key": "G", "mode": "major",
  "dominant_pitches": ["G", "D", "B", "A"],
  "windows": [
    {"idx": 0, "start": 0.0,  "end": 0.4, "bass": 0.004, "mid": 0.004, "treble": 0.011, ...},
    ...
  ]
}
```

모델에게 "4~8개의 segment로 전체 길이를 덮되, 인접 윈도우가 비슷하면 합쳐라"고 지시. 응답은 엄격한 JSON 스키마:

```json
{
  "overview": "...",
  "segments": [
    {"start": 0.0, "end": 32.5, "heading": "...", "text": "..."},
    ...
  ]
}
```

### 5.2 provider 3종, 하나로 묶인 어댑터

- **Bedrock**: `Authorization: Bearer $AWS_BEARER_TOKEN_BEDROCK` 헤더만으로 호출. boto3/SigV4 필요 없어서 Docker가 훨씬 가벼워졌다
- **Anthropic**: `x-api-key` 헤더 + Messages API
- **OpenAI**: `response_format: {"type": "json_object"}` 로 JSON 보장

세 provider 전부 같은 `CommentaryResult` dataclass를 반환하도록 어댑터를 짰다. 프런트는 차이를 몰라도 된다.

### 5.3 Bedrock의 함정

첫 호출은 `"model identifier is invalid"`로 실패했다. 두 번째는 `"on-demand throughput isn't supported"`. 원인은 이거였다:

> Claude 4.x on-demand Bedrock 호출은 **raw 모델 ID가 아니라 inference profile ID**를 요구한다.

`aws bedrock list-foundation-models`와 `list-inference-profiles`를 차례로 조회해 `us.anthropic.claude-sonnet-4-6`라는 정확한 profile ID를 찾고서야 통과됐다. 한국 리전이나 다른 리전을 쓰는 사람을 위해 README에 이 함정을 경고로 박아뒀다.

### 5.4 언어 문제

"한국어로 지정해도 영어로 나오는데?" 하고 내가 물었다. 원인은 **system 프롬프트가 영어라서 모델이 출력 언어를 영어에 맞추려는 관성**이었다. 해결 방법 두 가지:

1. ISO 코드 `"ko"`를 `"Korean (한국어)"`처럼 **완전한 이름**으로 변환
2. system + user 프롬프트 양쪽에 "다른 언어로 출력하면 실패"를 강하게 명시

```python
system = (
    f"...\n\n"
    f"ALL human-readable output fields (`overview`, `heading`, `text`) MUST "
    f"be written in {lang_label}. Do NOT output English if the requested "
    f"language is not English..."
)
```

고치고 재시도하니 깔끔한 한국어 8 segment가 즉시 돌아왔다. 지시를 한 곳이 아니라 두 곳에 넣는다는 게 의외로 효과가 컸다.

### 5.5 재생 시간 동기화 티커

`CommentaryTicker`가 `requestAnimationFrame`으로 `audioEl.currentTime`을 구독하며 현재 구간을 찾고, 금색 프로그레스 바가 구간 내부에서 차오른다:

```tsx
const active = segs.find(s => currentTime >= s.start && currentTime < s.end);
const progress = Math.min(1, (currentTime - active.start) / (active.end - active.start));
```

음악 흐르는 동안 해설이 자연스럽게 넘어가는 걸 보면서 "라디오 해설 같다"는 생각이 들었다.

---

## 6. Docker → Beanstalk 배포

개발은 `docker compose up` 한 줄로 끝나지만, 배포할 때는 몇 가지 손봐야 했다.

### 6.1 dev vs prod 차이

| 항목 | dev | prod |
|---|---|---|
| Next.js 실행 | `next dev` (HMR) | `next build` + `node server.js` (standalone output) |
| 백엔드 노출 | `0.0.0.0:8000` 외부 포트 | 내부 네트워크만, frontend가 `/api/*` 프록시 |
| CORS | 필요 (교차 오리진) | **불필요** — 같은 오리진 |
| 환경변수 전달 | `.env`로 docker compose | Beanstalk option settings + platform secrets |

`next.config.mjs`에 `output: 'standalone'` + `rewrites()`를 추가했다:

```js
async rewrites() {
  const upstream = process.env.BACKEND_INTERNAL_URL ?? 'http://backend:8000';
  return [{ source: '/api/:path*', destination: `${upstream}/api/:path*` }];
},
```

프런트엔드 컨테이너가 Next 웹 + 리버스 프록시를 겸하는 형태. 외부에 포트 하나만 열면 되고, CORS 설정 자체가 사라지는 게 깔끔해서 마음에 들었다.

### 6.2 ECR에 미리 빌드

처음엔 "Beanstalk가 소스에서 빌드하게 할까" 생각했는데, t3.small에서 `npm install` + `next build`는 메모리 압박이 심할 게 뻔했다. 대신 **로컬에서 `docker buildx --platform linux/amd64`로 빌드해 ECR에 push**하고 Beanstalk는 image만 pull하도록 했다.

```bash
docker buildx build --platform linux/amd64 \
  -t ${ACCOUNT}.dkr.ecr.us-east-1.amazonaws.com/spatium-backend:latest \
  -f backend/Dockerfile --push backend
```

내 개발 머신이 darwin/arm64라 linux/amd64로 cross-build가 필요했는데 buildx가 QEMU를 써서 처리해줬다. 빌드 시간은 각 5~10분 걸렸다.

### 6.3 EB 번들은 docker-compose 한 장

Beanstalk v4 Docker 플랫폼은 루트에 `docker-compose.yml` 한 장만 있으면 된다. 놀랄 정도로 단순하다:

```yaml
services:
  backend:
    image: ${ACCOUNT}.dkr.ecr.us-east-1.amazonaws.com/spatium-backend:latest
    environment:
      - AWS_BEARER_TOKEN_BEDROCK=${AWS_BEARER_TOKEN_BEDROCK}
  frontend:
    image: ${ACCOUNT}.dkr.ecr.us-east-1.amazonaws.com/spatium-frontend:latest
    ports: ["80:3000"]
    depends_on: [backend]
```

`zip docker-compose.yml` → S3 → `create-application-version` → `create-environment`.

### 6.4 EC2 → ECR pull 권한

EB 기본 instance role(`aws-elasticbeanstalk-ec2-role`)에 `AmazonEC2ContainerRegistryReadOnly`를 붙여야 image pull이 된다. 처음엔 이걸 놓쳐서 `Access Denied`가 떴는데, 로그로 원인 확인 후 policy 하나 attach로 해결.

### 6.5 비용 최적화

**SingleInstance** 환경(ALB 없음)을 선택했다. `t3.small` + EIP = 월 **약 $15–18**. ALB 붙이면 +$16/월인데, 개인 데모로는 single이 충분하고 HTTPS가 필요해지면 그때 ALB로 마이그레이션하면 된다.

---

## 7. AI와 페어 프로그래밍하면서 배운 것

이 프로젝트는 **"내가 AI에게 무엇을 말했는가"만큼이나, "AI가 내게 무엇을 되돌려 말해줬는가"** 가 프로젝트 질에 크게 영향을 줬다. 내가 AI를 쓰면서 이번에 가장 크게 느낀 세 가지:

### 7.1 "가능합니다" 대신 "이런 선택지가 있습니다"

Freepik 사진을 공유하며 "이 퀄리티로" 라고 요청했을 때, AI가 "네 해보겠습니다" 라고 답했다면 하루 종일 geometry 포문을 돌려도 "맨들맨들한 3D 모형"에서 벗어나지 못했을 거다. 대신 받은 답은 "사진급은 불가능합니다. 세 가지 길이 있는데 각각 장단점이…" 였다. 이 한 문장이 이후 모든 걸 결정했다. **사람도 AI도, 안 되는 건 일찍 말해주는 쪽이 서로 이익이다.**

### 7.2 증상이 아니라 원인

"소리가 안 난다"와 "Provider list error: Failed to fetch"는 둘 다 표면 증상이 여러 개였지만 원인은 각각 하나였다. 전자는 `MediaElementAudioSourceNode` 연결 순서 문제, 후자는 `127.0.0.1 vs localhost` origin 차이. **원인 하나 고치면 증상 여러 개가 같이 사라진다**는 걸 다시 배웠다.

### 7.3 확인을 아끼지 말 것

내가 "bedrock API key 방식이 맞는지 확인해"라고 물었을 때, AI가 "네 맞습니다"라고만 답했다면 나는 찜찜했을 거다. 실제로 받은 답은 **코드 경로, 환경변수 이름, 실제 헤더 모양, 이미 성공한 테스트 로그**까지 구체적으로 짚어주는 내용이었다. "맞다"는 단어 자체는 가치가 낮고, **맞다는 근거**가 가치다. 이 원칙은 내가 팀원들과 일할 때도 써먹어야겠다 싶었다.

### 7.4 같은 함정 두 번 밟지 않기

Docker compose + volume mount 환경에서 `package.json`을 바꾸고 컨테이너 안에서 `npm install`을 하면 컨테이너를 재시작하는 순간 이미지의 옛 `node_modules`로 되돌아간다. 한 번 당하고 나서 README에 이 순서를 못박아 뒀다:

```bash
# 패키지 추가할 때
# 1) host의 package.json 수정
# 2) docker compose build frontend   ← 이게 있어야 이미지에 영구 반영
# 3) docker compose up -d
```

---

## 8. 현재 상태 & 다음 단계

**지금 되는 것**
- URL 붙이거나 파일 업로드 → 분석 → 선택한 공간에 들어가 WASD로 걸어다님
- 걸어가며 공간 전환 시 음향(IR + panner)이 즉시 변함
- HUD에 실시간 chroma 막대 + 라이브 키/BPM
- 재생 시간 따라 흐르는 한국어 해설 티커 (Bedrock Sonnet 4.6 기본)
- GitHub private repo 업로드 완료

**남긴 숙제**
- glTF 고해상도 공간 모델 임포트 (진짜 사진급 퀄리티)
- 다중 곡 큐 / 플레이리스트
- WebXR 지원 (헤드셋으로 걸어보기)
- 해설 품질 피드백 루프 — "이 해설 별로" 버튼 누르면 재생성

---

## 9. 라이선스

- **코드**: MIT (계획)
- **텍스처**: Poly Haven **CC0**
- **음원**: 사용자가 제공. 퍼블릭 도메인 음원(Musopen, Internet Archive 등) 권장

---

## 10. 마치며

클래식은 "정확히 들어야 하는 음악"이라는 부담이 있는 장르다. 이 프로젝트는 내가 그 부담을 스스로 덜어보려고 만든 쪽에 가깝다. **"일단 공간에 들어가서 걸어보자"** 는 쉬운 초대장 같은 걸 만들고 싶었다.

바흐의 푸가가 몇 분짜리인지 몰라도 괜찮다. 제단 앞에서 고개를 들어 rose window를 보고, 베이스 라인이 지나갈 때 바닥이 울리는 걸 느끼면 — 그게 이미 감상이다. 그 지점까지 누군가를 데려갈 수만 있다면 이 프로젝트는 성공이다.

AI와 하루 동안 이걸 만들면서, 예전 같으면 주말 내내 고민했을 결정들(공간을 어떻게 표현할지, 어떤 reverb 알고리즘을 쓸지, LLM 프롬프트를 어떻게 구조화할지)이 **대화 몇 번으로 해결됐다**. 대신 내가 해야 할 일은 **뭐가 옳은 방향인지 빠르게 판단하고 선택하는 것**이었다. 코드를 적게 쓰는 만큼 질문과 결정에 더 집중하게 됐다.

*— Made in a day. Sources: https://github.com/lufianlee/classic-webgl (private)*
