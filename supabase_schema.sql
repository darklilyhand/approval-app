-- =============================================
-- 결재시스템 Supabase SQL 스키마
-- Supabase → SQL Editor 에 붙여넣고 Run 클릭
-- =============================================

-- 사용자 프로필 테이블
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  name TEXT NOT NULL,
  dept TEXT NOT NULL DEFAULT '미지정',
  title TEXT NOT NULL DEFAULT '사원',
  level INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 문서 테이블
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  author_id UUID REFERENCES profiles(id),
  author_name TEXT NOT NULL,
  author_dept TEXT NOT NULL,
  author_title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '대기중',
  fields JSONB NOT NULL DEFAULT '{}',
  approval_line JSONB NOT NULL DEFAULT '[]',
  approval_status JSONB NOT NULL DEFAULT '[]',
  history JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS (보안 정책) 활성화
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- 프로필: 로그인한 사용자는 모두 읽기 가능
CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (auth.role() = 'authenticated');
-- 프로필: 본인만 수정
CREATE POLICY "profiles_update" ON profiles FOR UPDATE USING (auth.uid() = id);
-- 프로필: 회원가입 시 insert
CREATE POLICY "profiles_insert" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- 문서: 로그인한 사용자는 모두 읽기 가능
CREATE POLICY "docs_select" ON documents FOR SELECT USING (auth.role() = 'authenticated');
-- 문서: 로그인한 사용자는 생성 가능
CREATE POLICY "docs_insert" ON documents FOR INSERT WITH CHECK (auth.role() = 'authenticated');
-- 문서: 로그인한 사용자는 수정 가능 (결재 처리)
CREATE POLICY "docs_update" ON documents FOR UPDATE USING (auth.role() = 'authenticated');

-- 실시간 구독 활성화
ALTER PUBLICATION supabase_realtime ADD TABLE documents;
