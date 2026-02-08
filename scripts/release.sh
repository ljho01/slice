#!/bin/bash
set -euo pipefail

# ============================================================
# Slice 릴리스 스크립트
# 빌드 → Apple 코드서명 + 공증 → GitHub Release 생성
#
# 사용법:
#   bun run release
#   bun run release -- --skip-build   (이미 빌드된 경우)
#   bun run release -- --draft        (드래프트 릴리스)
# ============================================================

REPO="ljho01/slice"
NOTARY_PROFILE="slice-notary"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT_DIR/apps/desktop/src-tauri"
BUNDLE_DIR="$APP_DIR/target/release/bundle"

# 옵션 파싱
SKIP_BUILD=false
DRAFT=false
for arg in "$@"; do
  case $arg in
    --skip-build) SKIP_BUILD=true ;;
    --draft) DRAFT=true ;;
  esac
done

# 색상
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

log()     { echo -e "${BLUE}[Slice]${NC} $1"; }
success() { echo -e "${GREEN}[✓]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
error()   { echo -e "${RED}[✗]${NC} $1"; exit 1; }

echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD} Slice 릴리스 스크립트${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# ────────────────────────────────────────
# 1. 전제 조건 확인
# ────────────────────────────────────────
log "전제 조건 확인 중..."

command -v gh    >/dev/null 2>&1 || error "gh CLI 필요: brew install gh"
command -v bun   >/dev/null 2>&1 || error "bun 필요"
command -v jq    >/dev/null 2>&1 || error "jq 필요: brew install jq"
command -v xcrun >/dev/null 2>&1 || error "Xcode CLI 도구 필요: xcode-select --install"

gh auth status >/dev/null 2>&1 || error "gh 로그인 필요: gh auth login"

success "CLI 도구 확인 완료"

# ────────────────────────────────────────
# 2. Apple 서명/공증 확인
# ────────────────────────────────────────
log "Apple 서명/공증 설정 확인 중..."

# 코드서명 ID
if [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
  error "APPLE_SIGNING_IDENTITY가 설정되지 않았습니다.

  .zshrc에 추가:
  export APPLE_SIGNING_IDENTITY=\"Developer ID Application: Your Name (TEAMID)\""
fi

# notarytool 키체인 프로필 확인
if ! xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
  error "notarytool 키체인 프로필 '$NOTARY_PROFILE'을 찾을 수 없습니다.

  프로필 생성:
  xcrun notarytool store-credentials \"$NOTARY_PROFILE\" \\
    --apple-id \"your@email.com\" \\
    --password \"app-specific-password\" \\
    --team-id \"TEAMID\""
fi

# Tauri 업데이터 서명 키 (Tauri v2는 TAURI_SIGNING_PRIVATE_KEY에 키 내용을 직접 넣어야 함)
if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  KEY_FILE="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.tauri/slice.key}"
  if [ -f "$KEY_FILE" ]; then
    export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_FILE")"
    export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-slice-updater-key}"
    warn "$KEY_FILE 에서 키 로드 완료"
  else
    error "업데이터 서명 키를 찾을 수 없습니다: $KEY_FILE"
  fi
fi

success "서명/공증 설정 확인 완료"
log "  서명 ID: $APPLE_SIGNING_IDENTITY"
log "  공증 프로필: $NOTARY_PROFILE"

# ────────────────────────────────────────
# 3. 버전 확인
# ────────────────────────────────────────
VERSION=$(jq -r '.version' "$APP_DIR/tauri.conf.json")
TAG="v$VERSION"

log "릴리스 버전: ${BOLD}$TAG${NC}"

# 버전 일치 확인
CARGO_VER=$(grep '^version' "$APP_DIR/Cargo.toml" | head -1 | sed 's/.*"\(.*\)".*/\1/')
PKG_VER=$(jq -r '.version' "$ROOT_DIR/apps/desktop/package.json")

if [ "$VERSION" != "$CARGO_VER" ] || [ "$VERSION" != "$PKG_VER" ]; then
  error "버전 불일치!
  tauri.conf.json: $VERSION
  Cargo.toml:      $CARGO_VER
  package.json:    $PKG_VER

  세 파일의 버전을 동일하게 맞추세요."
fi

# 이미 릴리스가 있는지 확인
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  error "$TAG 릴리스가 이미 존재합니다. 버전을 올려주세요."
fi

success "버전 $TAG 확인 완료"

# ────────────────────────────────────────
# 4. Git 상태 확인
# ────────────────────────────────────────
log "Git 상태 확인 중..."

if [ -n "$(git -C "$ROOT_DIR" status --porcelain)" ]; then
  warn "커밋되지 않은 변경사항이 있습니다."
  git -C "$ROOT_DIR" status --short
  echo ""
  read -p "  계속 진행하시겠습니까? (y/N) " -n 1 -r
  echo ""
  [[ $REPLY =~ ^[Yy]$ ]] || exit 0
fi

CURRENT_BRANCH=$(git -C "$ROOT_DIR" branch --show-current)
log "현재 브랜치: $CURRENT_BRANCH"

git -C "$ROOT_DIR" fetch origin "$CURRENT_BRANCH" --quiet 2>/dev/null || true
LOCAL=$(git -C "$ROOT_DIR" rev-parse HEAD)
REMOTE=$(git -C "$ROOT_DIR" rev-parse "origin/$CURRENT_BRANCH" 2>/dev/null || echo "none")

if [ "$LOCAL" != "$REMOTE" ]; then
  warn "로컬과 리모트가 다릅니다."
  read -p "  git push 실행? (Y/n) " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Nn]$ ]]; then
    git -C "$ROOT_DIR" push origin "$CURRENT_BRANCH"
    success "git push 완료"
  fi
fi

# ────────────────────────────────────────
# 5. Tauri 빌드 (코드서명만, 공증은 아래에서)
# ────────────────────────────────────────
if [ "$SKIP_BUILD" = true ]; then
  warn "빌드 건너뜀 (--skip-build)"
else
  log "Tauri 빌드 시작 (코드서명 포함)..."
  echo ""

  # APPLE_ID 등을 unset해서 Tauri가 자동 공증하지 않도록 함
  unset APPLE_ID 2>/dev/null || true
  unset APPLE_PASSWORD 2>/dev/null || true
  unset APPLE_TEAM_ID 2>/dev/null || true

  cd "$ROOT_DIR/apps/desktop"
  bun run tauri build
  cd "$ROOT_DIR"

  echo ""
  success "빌드 + 코드서명 완료"
fi

# ────────────────────────────────────────
# 6. 빌드 산출물 확인
# ────────────────────────────────────────
log "빌드 산출물 확인 중..."

ARCH=$(uname -m)
case "$ARCH" in
  arm64)  ARCH_LABEL="aarch64" ;;
  x86_64) ARCH_LABEL="x64" ;;
  *)      ARCH_LABEL="$ARCH" ;;
esac

DMG=$(find "$BUNDLE_DIR/dmg" -name "*.dmg" 2>/dev/null | head -1)
APP_TAR=$(find "$BUNDLE_DIR/macos" -name "*.app.tar.gz" ! -name "*.sig" 2>/dev/null | head -1)
APP_SIG=$(find "$BUNDLE_DIR/macos" -name "*.app.tar.gz.sig" 2>/dev/null | head -1)
APP_BUNDLE=$(find "$BUNDLE_DIR/macos" -name "*.app" -type d 2>/dev/null | head -1)

[ -n "$DMG" ] && [ -f "$DMG" ]                 || error "DMG 파일을 찾을 수 없습니다."
[ -n "$APP_TAR" ] && [ -f "$APP_TAR" ]         || error ".app.tar.gz 파일을 찾을 수 없습니다."
[ -n "$APP_SIG" ] && [ -f "$APP_SIG" ]         || error ".app.tar.gz.sig 파일을 찾을 수 없습니다."
[ -n "$APP_BUNDLE" ] && [ -d "$APP_BUNDLE" ]   || error ".app 번들을 찾을 수 없습니다."

success "빌드 산출물 확인 완료"

# ────────────────────────────────────────
# 7. Apple 공증 (notarization)
# ────────────────────────────────────────
log "Apple 공증 제출 중 (DMG)..."
log "  파일: $(basename "$DMG")"
log "  프로필: $NOTARY_PROFILE"
echo ""

xcrun notarytool submit "$DMG" \
  --keychain-profile "$NOTARY_PROFILE" \
  --wait

echo ""
success "공증 승인 완료"

# Staple
log "공증 티켓 스테이플링..."
xcrun stapler staple "$DMG"
success "DMG 스테이플링 완료"

# .app도 공증 + 스테이플 (자동 업데이터용)
log "Apple 공증 제출 중 (.app)..."

# .app을 zip으로 만들어서 제출
APP_ZIP="$BUNDLE_DIR/macos/Slice_notarize.zip"
ditto -c -k --keepParent "$APP_BUNDLE" "$APP_ZIP"

xcrun notarytool submit "$APP_ZIP" \
  --keychain-profile "$NOTARY_PROFILE" \
  --wait

echo ""
success ".app 공증 승인 완료"

xcrun stapler staple "$APP_BUNDLE"
success ".app 스테이플링 완료"

rm -f "$APP_ZIP"

# 스테이플된 .app으로 .app.tar.gz 재생성
log "스테이플된 .app으로 업데이터 번들 재생성 중..."
APP_NAME=$(basename "$APP_BUNDLE")
TAR_DIR=$(dirname "$APP_TAR")

tar -czf "$APP_TAR" -C "$(dirname "$APP_BUNDLE")" "$APP_NAME"
success "업데이터 번들 재생성 완료"

# 업데이터 서명 재생성
if [ -n "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]; then
  log "업데이터 서명 재생성 중..."

  # tauri signer를 사용해서 서명 재생성
  cd "$ROOT_DIR/apps/desktop"
  bunx tauri signer sign \
    --private-key "$TAURI_SIGNING_PRIVATE_KEY_PATH" \
    --password "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" \
    "$APP_TAR"
  cd "$ROOT_DIR"

  success "업데이터 서명 재생성 완료"
fi

DMG_SIZE=$(du -h "$DMG" | cut -f1)
echo ""
success "최종 산출물:"
log "  DMG: $(basename "$DMG") ($DMG_SIZE) — 서명 + 공증 + 스테이플"
log "  TAR: $(basename "$APP_TAR") — 서명 + 공증 + 스테이플"
log "  SIG: $(basename "$APP_SIG")"

# ────────────────────────────────────────
# 8. Git 태그 생성 및 푸시
# ────────────────────────────────────────
if git -C "$ROOT_DIR" rev-parse "$TAG" >/dev/null 2>&1; then
  warn "태그 $TAG가 이미 존재합니다. 기존 태그 사용."
else
  log "Git 태그 생성: $TAG"
  git -C "$ROOT_DIR" tag "$TAG"
  git -C "$ROOT_DIR" push origin "$TAG"
  success "태그 $TAG 푸시 완료"
fi

# ────────────────────────────────────────
# 9. latest.json 생성 (자동 업데이터용)
# ────────────────────────────────────────
log "latest.json 생성 중..."

SIGNATURE=$(cat "$APP_SIG")
PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TAR_FILENAME=$(basename "$APP_TAR")
PLATFORM_KEY="darwin-$ARCH_LABEL"

LATEST_JSON="$ROOT_DIR/tmp_latest.json"

cat > "$LATEST_JSON" <<EOF
{
  "version": "$VERSION",
  "notes": "Slice $TAG 릴리스",
  "pub_date": "$PUB_DATE",
  "platforms": {
    "$PLATFORM_KEY": {
      "signature": "$SIGNATURE",
      "url": "https://github.com/$REPO/releases/download/$TAG/$TAR_FILENAME"
    }
  }
}
EOF

success "latest.json 생성 완료"

# ────────────────────────────────────────
# 10. GitHub Release 생성 및 파일 업로드
# ────────────────────────────────────────
log "GitHub Release 생성 중..."

DRAFT_FLAG=""
if [ "$DRAFT" = true ]; then
  DRAFT_FLAG="--draft"
  warn "드래프트 모드로 생성합니다."
fi

gh release create "$TAG" \
  --repo "$REPO" \
  --title "Slice $TAG" \
  --notes "$(cat <<EOF
## Slice $TAG

### 다운로드

- **macOS**: \`$(basename "$DMG")\`

### 설치 방법

1. DMG 파일을 다운로드합니다.
2. DMG를 열고 Slice.app을 Applications 폴더로 드래그합니다.
3. Slice를 실행합니다.

> Apple 공증 완료 (Notarized)
EOF
)" \
  $DRAFT_FLAG \
  "$DMG" \
  "$APP_TAR" \
  "$APP_SIG" \
  "$LATEST_JSON#latest.json"

success "GitHub Release 생성 완료"

# 정리
rm -f "$LATEST_JSON"

# ────────────────────────────────────────
# 완료
# ────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN} Slice $TAG 릴리스 완료!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e " 릴리스: ${BOLD}https://github.com/$REPO/releases/tag/$TAG${NC}"
echo ""
echo -e " 업로드된 파일:"
echo -e "   - $(basename "$DMG")          (사용자 배포용, 공증 완료)"
echo -e "   - $(basename "$APP_TAR")      (자동 업데이트용, 공증 완료)"
echo -e "   - $(basename "$APP_SIG")      (업데이터 서명)"
echo -e "   - latest.json                 (업데이터 매니페스트)"
echo ""
