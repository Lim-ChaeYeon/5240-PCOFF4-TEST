# SmartScreen·코드 서명 체크리스트

Windows Defender / SmartScreen 경고 최소화 및 원인 추적·소명용 증적 확보를 위한 체크리스트.  
릴리즈·배포 단계에서 코드 서명·notarization 적용 시 참고.

---

## 1. 코드 서명 (최우선)

### Windows (Authenticode)

- [ ] **Authenticode 적용**: 설치 EXE, 언인스톨러, 업데이트 바이너리 전부 서명
- [ ] **EV Code Signing** (가능 시): SmartScreen 평판 축적에 유리
- [ ] **타임스탬프 서버**: 만료 후에도 서명 유효
  - 예: `http://timestamp.digicert.com`, `http://timestamp.sectigo.com`
- [ ] **CI 게이트**: 빌드 후 `signtool verify /pa /v <file>` 필수 통과
- [ ] README/운영문서에 Windows 서명·검증 절차(signtool 등) 명시

### macOS

- [ ] **Notarization 필수**: 공개 배포 시 Apple notarization 적용
- [ ] **검증**: `codesign --verify --deep --strict <path>`
- [ ] CI에서 notarization 후 검증 단계 포함

---

## 2. SmartScreen 평판

- [ ] **일관성**: 제품명/회사명/서명자·배포 URL·파일명 릴리즈 단위로 일관 유지
- [ ] **서명자 평판**: 동일 인증서 지속 사용 (변경 최소화)
- [ ] **배포**: 릴리즈 단위 배포, 중간 빌드 직접 배포 지양

---

## 3. 업데이트 무결성 (에이전트 측)

- [ ] **아티팩트**: 서명 + SHA-256, 검증 실패 시 설치 중단·상세 로그
- [ ] **매니페스트**: 버전·해시·배포 시각·서명자 정보 보관
- [ ] **실패 원인 구분 로깅** (구현됨):
  - `UPDATE_SIGNATURE_INVALID`: 서명 검증 실패
  - `UPDATE_HASH_MISMATCH`: SHA-256 등 해시 불일치
  - `UPDATE_NETWORK_ERROR`: 네트워크 오류
  - `UPDATE_FAILED`: 기타 실패
- 로그 검색: `logs/YYYY-MM-DD.jsonl`에서 위 로그 코드로 원인 추적

---

## 4. 설치기 최소 권한·투명화

- [ ] 불필요한 시스템 변경 최소화
- [ ] 관리자 작업 분리·문서화
- [ ] INSTALL_* 이벤트 일관 기록 (도입 시 logcode.md 동기화)

---

## 5. 오탐 대응

- [ ] **Microsoft 제출**: https://www.microsoft.com/wdsi/filesubmission
- [ ] **VirusTotal**: 벤더별 오탐 신고 링크 참조
- [ ] **아카이빙**: 릴리즈마다 해시·서명·탐지 로그 보관
- [ ] **고객사 가이드**: 배포 URL·해시 검증·서명 확인 방법 포함

---

## 6. 릴리즈 전·중·후

| 시점 | 항목 |
|------|------|
| **전** | 인증서 유효성, 빌드 재현성, 보안 점검, 이전 버전 오탐 여부 확인 |
| **중** | 서명 → 검증 → SHA-256 생성 → 매니페스트 업로드 |
| **후** | SmartScreen 경고 모니터링, 오탐 발생 시 즉시 제출, 회고 기록 |

---

## 7. 관련 문서

- **업데이트·릴리즈**: [업데이트_릴리즈_점검.md](./업데이트_릴리즈_점검.md)
- **로그 코드**: [operations/logcode.md](./operations/logcode.md) — UPDATE_* 구분 코드
- **진행 상황**: [다음_개발_진행_사항.md](./다음_개발_진행_사항.md) §12
