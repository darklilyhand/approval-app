# 📋 내부결재 시스템 — 배포 가이드

> 복붙만으로 완료! 총 소요시간 약 20분

---

## 📦 전체 구조

```
결재시스템 앱 (Vercel) ──── Supabase DB (데이터 저장/로그인)
```

- **Vercel**: 앱을 인터넷에 올려주는 서비스 (무료)
- **Supabase**: DB + 로그인 기능 (무료)
- **GitHub**: 코드 저장소 — Vercel이 여기서 자동 배포

---

## STEP 1 — GitHub에 코드 올리기

1. https://github.com 접속 → 로그인
2. 오른쪽 상단 **[+] → New repository** 클릭
3. Repository name: `approval-app` 입력
4. **Create repository** 클릭
5. PC에서 명령 프롬프트(CMD) 열기
   - Windows 키 + R → `cmd` 입력 → 확인

6. 아래 명령어 순서대로 복붙 (폴더 위치는 본인에 맞게 변경):

```
cd C:\Users\본인이름\Desktop
```

> 이 approval-app 폴더를 바탕화면에 저장했다면 위처럼 입력

```
cd approval-app
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/본인GitHub아이디/approval-app.git
git push -u origin main
```

> ⚠️ 위 주소에서 `본인GitHub아이디` 부분을 실제 GitHub 아이디로 교체

---

## STEP 2 — Supabase 설정

1. https://supabase.com 접속 → **Start your project** → 구글/깃허브로 가입
2. **New project** 클릭
   - Name: `approval-app`
   - Database Password: 기억하기 쉬운 비밀번호 입력
   - Region: **Northeast Asia (Seoul)** 선택
   - **Create new project** 클릭 (1~2분 대기)

3. 왼쪽 메뉴 **SQL Editor** 클릭
4. `supabase_schema.sql` 파일 내용을 전체 복사해서 붙여넣기
5. 오른쪽 상단 **Run** 클릭 → "Success" 확인

6. 왼쪽 메뉴 **Project Settings → API** 클릭
7. 아래 두 값을 메모장에 복사:
   - **Project URL**: `https://xxxx.supabase.co` 형태
   - **anon / public** 키: `eyJh...` 로 시작하는 긴 문자열

---

## STEP 3 — Vercel 배포

1. https://vercel.com 접속 → **GitHub으로 로그인**
2. **Add New → Project** 클릭
3. `approval-app` 찾아서 **Import** 클릭
4. **Environment Variables** 섹션에서 아래 두 개 추가:

| Name | Value |
|------|-------|
| `REACT_APP_SUPABASE_URL` | STEP 2에서 복사한 Project URL |
| `REACT_APP_SUPABASE_ANON_KEY` | STEP 2에서 복사한 anon 키 |

5. **Deploy** 클릭 → 2~3분 대기

6. 배포 완료되면 `https://approval-app-xxxx.vercel.app` 형태의 주소 생성!

---

## STEP 4 — 직원 계정 만들기

1. 앱 주소 접속 → **회원가입** 탭 클릭
2. 이메일 + 비밀번호 입력 → 가입
3. 이메일 인증 메일 확인 → 인증 클릭
4. 다시 앱 접속 → 로그인 → 이름/부서/직함 입력

> 김현수 소장, 이상아 소장 계정도 동일하게 만들면
> 전결 결재 기능이 활성화됩니다!

---

## STEP 5 — 모바일 앱처럼 설치 (선택사항)

### 아이폰
1. Safari로 앱 주소 접속
2. 하단 공유 버튼(□↑) 탭
3. **홈 화면에 추가** 선택

### 안드로이드
1. Chrome으로 앱 주소 접속
2. 주소창 옆 **⋮** 메뉴
3. **앱 설치** 또는 **홈 화면에 추가** 선택

---

## ✅ 완료 체크리스트

- [ ] GitHub에 코드 업로드
- [ ] Supabase 프로젝트 생성 + SQL 실행
- [ ] Vercel 배포 + 환경변수 설정
- [ ] 앱 주소로 접속 확인
- [ ] 소장 포함 전체 직원 계정 생성

---

## 🆘 문제가 생기면?

- **앱이 흰 화면만 나올 때**: Vercel 환경변수가 정확한지 확인
- **로그인이 안 될 때**: Supabase 이메일 인증 여부 확인 (스팸 폴더도 확인)
- **DB 에러 날 때**: SQL Editor에서 스키마 다시 실행

---

## 💰 비용

| 서비스 | 무료 한도 | 예상 비용 |
|--------|----------|----------|
| Vercel | 팀원 100명, 월 100GB | **무료** |
| Supabase | DB 500MB, 월 2GB 전송 | **무료** |

소규모 사내 시스템은 **둘 다 무료**로 충분합니다!
