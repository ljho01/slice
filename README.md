# Slice

Splice에서 다운로드한 오디오 샘플을 로컬에서 탐색하고 미리듣기하는 macOS 데스크톱 앱입니다.

## 주요 기능

- 🎵 **Splice 라이브러리 통합**: Splice 앱의 데이터베이스를 자동으로 읽어 샘플 메타데이터 가져오기
- 📁 **로컬 라이브러리 관리**: `~/Slice/` 디렉토리에서 샘플 파일 관리
- 🔍 **강력한 검색 및 필터**: 텍스트, 장르, 악기, BPM, 키, 타입, 태그 등 다양한 조건으로 필터링
- 🎚️ **실시간 오디오 재생**: 
  - HTML5 Audio 기반 재생
  - 트랜스포즈 (-12 ~ +12 반음)
  - 역재생 지원
  - 파형 시각화
- 🎨 **모던 UI**: Tailwind CSS v4 + Radix UI 기반 다크 모드 인터페이스
- 🚀 **가상 스크롤**: 대량의 샘플을 빠르게 탐색
- 🔄 **자동 업데이트**: GitHub Releases를 통한 자동 업데이트 지원

## 기술 스택

- **프레임워크**: Tauri v2 (Rust + WebView)
- **프론트엔드**: React 18 + TypeScript + Vite 6
- **스타일링**: Tailwind CSS v4
- **UI 컴포넌트**: Radix UI + shadcn/ui
- **데이터베이스**: SQLite (rusqlite)
- **오디오 디코딩**: Symphonia (wav, mp3, flac, ogg, vorbis, aiff)
- **패키지 매니저**: Bun

## 설치

### 요구사항

- macOS 11 (Big Sur) 이상
- Splice 앱 설치 (선택 사항, Splice 샘플 가져오기 원하는 경우)

### 다운로드

[Releases](https://github.com/your-username/slice/releases) 페이지에서 최신 버전의 `.dmg` 파일을 다운로드하세요.

1. `Slice_x.x.x_aarch64.dmg` (Apple Silicon) 또는 `Slice_x.x.x_x64.dmg` (Intel) 다운로드
2. DMG 파일을 열고 `Slice.app`을 Applications 폴더로 드래그
3. Slice 실행

## 개발

### 개발 환경 설정

1. **필수 도구 설치**:
   - [Rust](https://www.rust-lang.org/tools/install)
   - [Bun](https://bun.sh/)
   - Xcode Command Line Tools

```bash
# Xcode Command Line Tools
xcode-select --install
```

2. **프로젝트 클론 및 의존성 설치**:

```bash
git clone https://github.com/your-username/slice.git
cd slice
bun install
```

3. **개발 서버 실행**:

```bash
bun run tauri dev
```

### 프로젝트 구조

```
slice/
├── src/                    # React 프론트엔드
│   ├── components/         # UI 컴포넌트
│   ├── routes/            # 라우트 페이지
│   ├── contexts/          # React Context
│   └── types.ts           # TypeScript 타입 정의
├── src-tauri/             # Rust 백엔드
│   ├── src/
│   │   └── lib.rs         # 모든 Tauri 커맨드 및 비즈니스 로직
│   ├── Cargo.toml         # Rust 의존성
│   └── tauri.conf.json    # Tauri 설정
└── sounds/                # 테스트용 샘플 파일 (git 미추적)
```

### 빌드

```bash
bun run tauri build
```

빌드된 파일은 `src-tauri/target/release/bundle/`에 생성됩니다.

## 배포

자세한 배포 가이드는 [DEPLOY.md](./DEPLOY.md)를 참고하세요.

## 라이선스

MIT License

## 기여

이슈 및 풀 리퀘스트를 환영합니다!
