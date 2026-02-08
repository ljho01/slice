# Slice 배포 가이드

## 원클릭 릴리스

### 사전 준비 (최초 1회)

#### 1. Apple Developer Program 가입 ($99/년)

[developer.apple.com](https://developer.apple.com/programs/) 에서 가입 후:
- Xcode → Settings → Accounts에서 Apple ID 추가
- "Developer ID Application" 인증서 생성 및 키체인에 설치

#### 2. notarytool 키체인 프로필 생성

앱 암호를 먼저 생성: [appleid.apple.com](https://appleid.apple.com/) → 로그인 → 앱 암호 → 암호 생성

```bash
xcrun notarytool store-credentials "slice-notary" \
  --apple-id "your@email.com" \
  --password "xxxx-xxxx-xxxx-xxxx" \
  --team-id "TEAMID"
```

> 키체인에 저장되므로 한번만 실행하면 됩니다.

#### 3. 환경변수 설정 (`~/.zshrc`)

```bash
# ── Apple 코드서명 ──
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"

# ── Tauri 업데이터 서명 ──
export TAURI_SIGNING_PRIVATE_KEY_PATH="$HOME/.tauri/slice.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="slice-updater-key"
```

설정 후 `source ~/.zshrc` 실행.

> 공증 인증 정보는 키체인 프로필(`slice-notary`)에 저장되어 있으므로 환경변수 불필요.

#### 4. CLI 도구 설치

```bash
brew install gh jq
gh auth login
```

### 릴리스 실행

#### 1. 버전 업데이트

세 파일의 버전을 동일하게 수정:
- `apps/desktop/src-tauri/tauri.conf.json` → `"version"`
- `apps/desktop/src-tauri/Cargo.toml` → `version`
- `apps/desktop/package.json` → `"version"`

#### 2. 커밋 & 릴리스

```bash
git add -A && git commit -m "v0.2.0" && git push

# 한 방에 빌드 → 서명 → 공증 → GitHub Release
bun run release
```

끝. 이게 전부입니다.

### 옵션

```bash
# 드래프트 릴리스 (수동 발행 필요)
bun run release:draft

# 이미 빌드된 산출물로 릴리스만 생성 (빌드 건너뜀)
bun run release:skip-build
```

## 릴리스 스크립트가 하는 일

`bun run release` 한 번이면 아래 과정이 자동으로 실행됩니다:

1. **전제조건 확인** — `gh`, `bun`, `jq`, `xcrun` 설치 여부, 환경변수 체크
2. **버전 검증** — `tauri.conf.json`, `Cargo.toml`, `package.json` 버전 일치 확인
3. **Git 상태 확인** — 커밋 안 된 변경사항, remote 동기화 여부 체크
4. **Tauri 빌드** — 프론트엔드(Vite) + 백엔드(Rust) 빌드
5. **Apple 코드서명** — `APPLE_SIGNING_IDENTITY`로 Developer ID 서명
6. **Apple 공증 (DMG)** — `notarytool submit --keychain-profile slice-notary` → 승인 대기
7. **DMG 스테이플링** — 공증 티켓을 DMG에 내장
8. **Apple 공증 (.app)** — 자동 업데이터용 .app도 별도 공증
9. **.app 스테이플링** → 업데이터 번들(.app.tar.gz) 재생성 + 서명 재생성
10. **Git 태그** — `vX.Y.Z` 태그 생성 및 push
11. **latest.json 생성** — 자동 업데이터용 매니페스트 (서명, URL 포함)
12. **GitHub Release** — 릴리스 생성 + 모든 파일 업로드

## 빌드 산출물

```
apps/desktop/src-tauri/target/release/bundle/
├── dmg/
│   └── Slice_X.Y.Z_aarch64.dmg     ← 사용자 배포용
└── macos/
    ├── Slice.app.tar.gz              ← 자동 업데이트용
    └── Slice.app.tar.gz.sig          ← 업데이터 서명
```

GitHub Release에 업로드되는 파일:
- `Slice_X.Y.Z_aarch64.dmg` — 사용자가 다운로드하는 DMG
- `Slice.app.tar.gz` — 앱 내 자동 업데이터가 사용
- `Slice.app.tar.gz.sig` — 업데이트 무결성 검증용 서명
- `latest.json` — 업데이터가 최신 버전 확인용

## 자동 업데이트 설정

### 업데이트 서명 키

- 비밀 키: `~/.tauri/slice.key`
- 공개 키: `~/.tauri/slice.key.pub`
- 비밀번호: `slice-updater-key`

> **경고**: `~/.tauri/slice.key` 파일은 절대 공유하거나 Git에 커밋하지 마세요!

### 업데이트 흐름

1. 앱 실행 시 `latest.json` 확인 (GitHub Release에서 다운로드)
2. 새 버전이면 `.app.tar.gz` 다운로드
3. `.sig` 파일로 서명 검증
4. 자동 업데이트 적용

### tauri.conf.json 업데이터 설정

```json
{
  "plugins": {
    "updater": {
      "active": true,
      "pubkey": "...",
      "endpoints": [
        "https://github.com/ljho01/slice/releases/latest/download/latest.json"
      ]
    }
  }
}
```

## 문제 해결

### "Developer ID Application" 인증서를 못 찾는 경우

```bash
# 키체인에 설치된 서명 ID 목록 확인
security find-identity -v -p codesigning
```

출력에서 `Developer ID Application: ...` 항목을 `APPLE_SIGNING_IDENTITY`에 설정하세요.

### 공증 실패

```bash
# 공증 기록 확인
xcrun notarytool history --keychain-profile "slice-notary"

# 특정 제출의 상세 로그
xcrun notarytool log <submission-id> --keychain-profile "slice-notary"
```

### 빌드 실패

```bash
# Rust 캐시 삭제 후 재빌드
rm -rf apps/desktop/src-tauri/target
bun run release
```

### 환경변수 확인

```bash
echo "APPLE_SIGNING_IDENTITY: $APPLE_SIGNING_IDENTITY"
echo "TAURI_SIGNING_PRIVATE_KEY_PATH: $TAURI_SIGNING_PRIVATE_KEY_PATH"

# 공증 프로필 확인
xcrun notarytool history --keychain-profile "slice-notary"
```

## 참고

- [Tauri v2 — Code Signing](https://tauri.app/distribute/sign/macos/)
- [Tauri v2 — Updater](https://tauri.app/plugin/updater/)
- [Apple Notarization](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
