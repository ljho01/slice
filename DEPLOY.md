# Slice 배포 가이드

## 배포 준비

### 1. 버전 업데이트

새 버전을 릴리스하기 전에 다음 파일들의 버전을 업데이트해야 합니다:

- `src-tauri/tauri.conf.json` → `version` 필드
- `src-tauri/Cargo.toml` → `version` 필드  
- `package.json` → `version` 필드

**예시**: `0.1.0` → `0.1.1` 또는 `0.2.0`

```bash
# 세 파일의 버전을 동일하게 맞춰주세요
```

### 2. 빌드

프로덕션 빌드를 실행합니다:

```bash
bun run tauri build
```

빌드가 완료되면 다음 경로에 파일이 생성됩니다:

```
src-tauri/target/release/bundle/
├── dmg/
│   └── Slice_0.1.0_aarch64.dmg (또는 x64)
└── macos/
    └── Slice.app.tar.gz
    └── Slice.app.tar.gz.sig
```

**중요한 파일들**:
- `Slice.app.tar.gz` - 자동 업데이트용 번들 (필수)
- `Slice.app.tar.gz.sig` - 서명 파일 (필수)
- `Slice_*.dmg` - 사용자 배포용 DMG

### 3. GitHub Release 생성

#### 3-1. Git 태그 생성 및 푸시

```bash
# 버전 태그 생성 (v 접두사 필수)
git tag v0.1.0

# 태그 푸시
git push origin v0.1.0
```

#### 3-2. GitHub에서 Release 생성

1. GitHub 저장소 → **Releases** → **Draft a new release** 클릭
2. **Choose a tag** → 방금 푸시한 태그 선택 (예: `v0.1.0`)
3. Release 제목 입력 (예: `v0.1.0`)
4. Release 설명 작성 (변경 사항, 버그 수정 등)
5. **Attach binaries** 섹션에 다음 파일들을 드래그 앤 드롭:
   - `Slice.app.tar.gz`
   - `Slice.app.tar.gz.sig`
   - `Slice_0.1.0_aarch64.dmg` (또는 x64)

#### 3-3. latest.json 파일 생성 및 업로드

자동 업데이트를 위해 `latest.json` 파일을 수동으로 생성하고 업로드해야 합니다:

**latest.json 템플릿**:
```json
{
  "version": "0.1.0",
  "notes": "버그 수정 및 성능 개선",
  "pub_date": "2026-02-08T12:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "여기에_시그니처_내용_붙여넣기",
      "url": "https://github.com/your-username/slice/releases/download/v0.1.0/Slice.app.tar.gz"
    }
  }
}
```

**시그니처 가져오기**:
```bash
cat src-tauri/target/release/bundle/macos/Slice.app.tar.gz.sig
```

출력된 내용을 `signature` 필드에 붙여넣으세요.

**주의사항**:
- `url`은 반드시 실제 GitHub release 다운로드 URL로 변경
- `pub_date`는 ISO 8601 형식 (현재 시각을 UTC로)
- Intel Mac의 경우 `"darwin-x86_64"` 플랫폼도 추가

#### 3-4. Release 발행

- **Publish release** 버튼 클릭

## 자동 업데이트 설정

### 업데이트 서명 키

프로젝트 초기 설정 시 이미 키페어가 생성되어 있습니다:

- 비밀 키: `~/.tauri/slice.key`
- 공개 키: `~/.tauri/slice.key.pub`
- 비밀번호: `slice-updater-key`

**⚠️ 경고**: `~/.tauri/slice.key` 파일은 절대 공유하거나 Git에 커밋하지 마세요!

### 빌드 시 서명

빌드 시 자동으로 서명하려면 환경 변수를 설정하세요:

```bash
export TAURI_SIGNING_PRIVATE_KEY_PATH="$HOME/.tauri/slice.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="slice-updater-key"

bun run tauri build
```

또는 `.zshrc` / `.bashrc`에 추가:

```bash
# Tauri updater
export TAURI_SIGNING_PRIVATE_KEY_PATH="$HOME/.tauri/slice.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="slice-updater-key"
```

### tauri.conf.json 설정

`src-tauri/tauri.conf.json`의 updater 설정:

```json
{
  "plugins": {
    "updater": {
      "active": true,
      "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEE2OTk4NUNBRjUyNThDM0IKUldRN2pDWDF5b1dacHZBWVhNTU1ibFpCZmc2b0hLUE1LNFVJWFlsdkF4d0lSNHVsZDZSV0IrYTcK",
      "endpoints": [
        "https://github.com/{{owner}}/{{repo}}/releases/latest/download/latest.json"
      ]
    }
  }
}
```

**GitHub URL 수정 필요**:
- `{{owner}}`: 본인의 GitHub 사용자명
- `{{repo}}`: 저장소 이름

예시: `https://github.com/jaeho/slice/releases/latest/download/latest.json`

## 배포 체크리스트

배포 전 확인사항:

- [ ] 세 파일의 버전 번호가 모두 동일한가? (`tauri.conf.json`, `Cargo.toml`, `package.json`)
- [ ] Git에 모든 변경사항이 커밋되었는가?
- [ ] 빌드가 성공적으로 완료되었는가?
- [ ] Git 태그가 생성되고 푸시되었는가?
- [ ] GitHub Release가 생성되었는가?
- [ ] `.app.tar.gz`, `.app.tar.gz.sig`, `.dmg` 파일이 모두 업로드되었는가?
- [ ] `latest.json` 파일이 생성되고 업로드되었는가?
- [ ] `latest.json`의 `signature`와 `url`이 올바른가?
- [ ] Release가 발행되었는가?

## 문제 해결

### 빌드 실패

```bash
# Rust 캐시 삭제
rm -rf src-tauri/target
bun run tauri build
```

### 서명 실패

환경 변수가 올바르게 설정되었는지 확인:

```bash
echo $TAURI_SIGNING_PRIVATE_KEY_PATH
echo $TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

### 자동 업데이트 작동 안 함

1. `tauri.conf.json`의 `endpoints` URL이 올바른지 확인
2. `latest.json`이 올바른 위치에 업로드되었는지 확인
3. `latest.json`의 형식이 올바른지 확인
4. 브라우저에서 `latest.json` URL에 직접 접근해보기

## 참고

- [Tauri Updater 공식 문서](https://tauri.app/v1/guides/distribution/updater)
- [GitHub Releases 가이드](https://docs.github.com/en/repositories/releasing-projects-on-github)
