
import { createClient } from '@supabase/supabase-js';
import './style.css';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
const db = url && key ? createClient(url, key) : null;
const app = document.querySelector('#app');

const areas = ['수원', '화성', '기흥', '동탄', '평택', '기타'];

let user = null;
let profile = null;
let jobs = [];
let tab = 'jobs';
let editing = null;
let search = '';
let ready = false;
let busy = false;
let epoch = 0;
let message = '';

const safe = v => String(v ?? '').replace(
  /[&<>"']/g,
  c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c])
);

const won = v => Number(v || 0).toLocaleString('ko-KR') + '원';
const el = id => document.getElementById(id);
const owner = j => !!user && j.owner_id === user.id;
const company = () =>
  !!user && ['company', 'agency'].includes(profile?.role);

function notify(text) {
  message = text;
  const n = el('notice');
  if (n) n.textContent = text;
}

function lock(on) {
  busy = on;
  document.querySelectorAll('button').forEach(b => {
    b.disabled = on;
  });
}

function frame(body) {
  app.innerHTML = `
    <header>
      <strong>👷 노가다ON</strong>
      <small>건설 구인구직 · 인력사무소</small>
    </header>
    <main>
      <div id="notice" role="status" aria-live="polite">
        ${safe(message)}
      </div>
      ${body}
    </main>
  `;
  if (busy) lock(true);
}

function nav() {
  return `<nav>${[
    ['jobs', '일자리'],
    ['post', '공고등록'],
    ['account', '내 계정']
  ].map(([id, title]) => `
    <button type="button"
      data-tab="${id}"
      class="${tab === id ? 'active' : ''}">
      ${title}
    </button>
  `).join('')}</nav>`;
}

function filtered() {
  const term = search.trim().toLowerCase();

  return term
    ? jobs.filter(j =>
        [j.title, j.region, j.description]
          .join(' ')
          .toLowerCase()
          .includes(term)
      )
    : jobs;
}

function cards(items) {
  return items.map(j => `
    <article>
      <span class="pill">${safe(j.region)}</span>
      <h3>${safe(j.title)}</h3>
      <p>
        일당 <b>${won(j.daily_pay)}</b>
        · 모집 ${safe(j.slots)}명
      </p>
      <p style="white-space:pre-wrap;overflow-wrap:anywhere">
        ${safe(j.description || '')}
      </p>

      ${j.contact_phone ? `
        <p>담당자 전화번호: ${safe(j.contact_phone)}</p>
        <a href="tel:${safe(
          String(j.contact_phone).replace(/[^0-9+]/g, '')
        )}">📞 전화하기</a>
      ` : ''}

      ${owner(j) ? `
        <div class="actions">
          <button type="button" data-edit="${safe(j.id)}">
            ✏️ 전체 수정
          </button>
          <button type="button" data-delete="${safe(j.id)}">
            🗑️ 삭제
          </button>
        </div>
      ` : ''}
    </article>
  `).join('') || '<p>등록된 공고가 없습니다.</p>';
}

function postForm() {
  if (!company()) {
    return `<section>
      <h2>공고 등록</h2>
      <p>업체 또는 인력사무소 계정으로 로그인해 주세요.</p>
    </section>`;
  }

  const j = editing || {};
  const value = name => safe(j[name] ?? '');
  const regions = [
    ...new Set([...(j.region ? [j.region] : []), ...areas])
  ];

  return `
    <section>
      <h2>${editing ? '구인공고 전체 수정' : '구인공고 등록'}</h2>

      <form id="post">
        <label>
          공고 제목
          <input name="title" required maxlength="120"
            value="${value('title')}">
        </label>

        <label>
          근무 지역
          <select name="region">
            ${regions.map(r => `
              <option value="${safe(r)}"
                ${j.region === r ? 'selected' : ''}>
                ${safe(r)}
              </option>
            `).join('')}
          </select>
        </label>

        <label>
          일당(원)
          <input name="daily_pay" type="number" min="1"
            step="1" required value="${value('daily_pay')}">
        </label>

        <label>
          모집인원
          <input name="slots" type="number" min="1"
            step="1" required value="${value('slots')}">
        </label>

        <label>
          담당자 전화번호
          <input name="contact_phone" type="tel" required
            maxlength="30" value="${value('contact_phone')}">
        </label>

        <label>
          상세 설명
          <textarea name="description" rows="12"
            maxlength="8000">${value('description')}</textarea>
        </label>

        <div class="actions">
          <button type="submit">
            ${editing ? '수정 저장' : '공고 등록'}
          </button>
          ${editing ? `
            <button type="button" data-cancel="1">
              수정 취소
            </button>
          ` : ''}
        </div>
      </form>
    </section>
  `;
}

function render() {
  if (!db) {
    frame(`<section>
      <h2>서비스 연결 설정 필요</h2>
      <p>Supabase 환경변수를 확인하세요.</p>
    </section>`);
    return;
  }

  if (!ready) {
    frame('<section><p>로그인 상태를 확인하고 있습니다.</p></section>');
    return;
  }

  if (!user) {
    frame(`
      <section>
        <h2>회원가입 · 로그인</h2>
        <form id="auth">
          <label>
            이메일
            <input name="email" type="email" required
              autocomplete="email">
          </label>
          <label>
            비밀번호
            <input name="password" type="password"
              minlength="8" required>
          </label>
          <label>
            가입 유형
            <select name="role">
              <option value="worker">구직자</option>
              <option value="company">건설업체</option>
              <option value="agency">인력사무소</option>
            </select>
          </label>
          <div class="actions">
            <button type="submit" name="mode" value="login">
              로그인
            </button>
            <button type="submit" name="mode" value="signup">
              회원가입
            </button>
          </div>
        </form>
        <p class="muted">
          회원가입 후 이메일 인증이 필요할 수 있습니다.
        </p>
      </section>
    `);
    return;
  }

  let body = '';

  if (tab === 'jobs') {
    body = `
      <section>
        <h2>현장 일자리</h2>
        <input id="search" placeholder="직종·지역 검색"
          aria-label="일자리 검색" value="${safe(search)}">
      </section>
      <div id="joblist">${cards(filtered())}</div>
    `;
  }

  if (tab === 'post') body = postForm();

  if (tab === 'account') {
    body = `
      <section>
        <h2>내 계정</h2>
        <p>${safe(user.email)}</p>
        <p>유형: ${safe(profile?.role || '설정되지 않음')}</p>
        <button type="button" id="logout">로그아웃</button>
      </section>
    `;
  }

  frame(nav() + body);
}

async function fetchJobs() {
  const { data, error } = await db.from('jobs')
    .select('*')
    .eq('status', 'open')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

async function refresh(id, version) {
  const list = await fetchJobs();

  if (user?.id !== id || epoch !== version) return false;

  jobs = list;
  render();
  return true;
}

async function applySession(session, version) {
  if (version !== epoch) return;

  const next = session?.user || null;
  const changed = user?.id !== next?.id;

  user = next;

  if (changed) {
    profile = null;
    jobs = [];
    editing = null;
    tab = 'jobs';
    message = '';
  }

  if (!next) {
    ready = true;
    render();
    return;
  }

  if (!changed && ready) return;

  ready = false;
  render();

  try {
    const [pr, js] = await Promise.all([
      db.from('profiles')
        .select('id,role')
        .eq('id', next.id)
        .maybeSingle(),
      fetchJobs()
    ]);

    if (pr.error) throw pr.error;
    if (user?.id !== next.id || epoch !== version) return;

    profile = pr.data;
    jobs = js;
    ready = true;
    render();
  } catch (err) {
    if (user?.id !== next.id || epoch !== version) return;

    ready = true;
    render();
    notify('조회 오류: ' + err.message);
  }
}

document.addEventListener('submit', async e => {
  const form = e.target;

  if (!['auth', 'post'].includes(form.id)) return;

  e.preventDefault();
  if (busy) return;

  const mode = e.submitter?.value === 'signup'
    ? 'signup'
    : 'login';

  const values = Object.fromEntries(new FormData(form));
  const id = user?.id;
  const version = epoch;
  const edit = editing;

  lock(true);

  try {
    if (form.id === 'auth') {
      const result = mode === 'signup'
        ? await db.auth.signUp({
            email: values.email,
            password: values.password,
            options: {
              data: { role: values.role }
            }
          })
        : await db.auth.signInWithPassword({
            email: values.email,
            password: values.password
          });

      if (result.error) throw result.error;

      if (mode === 'signup' && !result.data?.session) {
        notify('가입 요청 완료. 이메일 인증 후 로그인하세요.');
      } else {
        notify('로그인 상태를 확인 중입니다.');
      }
      return;
    }

    if (!company() || !ready) {
      throw Error('업체 또는 인력사무소 계정이 필요합니다.');
    }

    const payload = {
      title: String(values.title || '').trim(),
      region: String(values.region || '').trim(),
      daily_pay: Number(values.daily_pay),
      slots: Number(values.slots),
      contact_phone: String(values.contact_phone || '').trim(),
      description: String(values.description || '')
    };

    if (
      !payload.title ||
      !payload.region ||
      !payload.contact_phone ||
      !Number.isSafeInteger(payload.daily_pay) ||
      payload.daily_pay < 1 ||
      !Number.isSafeInteger(payload.slots) ||
      payload.slots < 1
    ) {
      throw Error('입력값을 확인하세요.');
    }

    let query;

    if (edit) {
      if (!owner(edit)) {
        throw Error('본인 공고만 수정할 수 있습니다.');
      }

      query = db.from('jobs')
        .update(payload)
        .eq('id', edit.id)
        .eq('owner_id', id);
    } else {
      query = db.from('jobs')
        .insert({ ...payload, owner_id: id });
    }

    const { data, error } = await query.select('id');

    if (error) throw error;

    if (data?.length !== 1) {
      throw Error('저장 결과를 확인하지 못했습니다.');
    }

    if (user?.id !== id || epoch !== version) return;

    editing = null;
    tab = 'jobs';

    if (await refresh(id, version)) {
      notify('공고가 저장되었습니다.');
    }
  } catch (err) {
    if (
      form.id === 'auth' ||
      (user?.id === id && epoch === version)
    ) {
      notify('오류: ' + err.message);
    }
  } finally {
    lock(false);
  }
});

document.addEventListener('input', e => {
  if (e.target.id !== 'search') return;

  search = e.target.value;
  const list = el('joblist');

  if (list) list.innerHTML = cards(filtered());
});

document.addEventListener('click', async e => {
  const button = e.target.closest('button');

  if (!button || busy) return;

  if (button.dataset.tab) {
    tab = button.dataset.tab;
    editing = null;
    message = '';
    render();
    return;
  }

  if (button.dataset.cancel) {
    editing = null;
    tab = 'jobs';
    render();
    return;
  }

  if (button.dataset.edit) {
    const job = jobs.find(
      j => String(j.id) === button.dataset.edit
    );

    if (!job || !owner(job)) {
      notify('본인 공고만 수정할 수 있습니다.');
      return;
    }

    editing = { ...job };
    tab = 'post';
    render();
    window.scrollTo(0, 0);
    return;
  }

  if (button.dataset.delete) {
    const job = jobs.find(
      j => String(j.id) === button.dataset.delete
    );

    if (!job || !owner(job)) {
      notify('본인 공고만 삭제할 수 있습니다.');
      return;
    }

    if (!confirm('이 공고를 삭제하시겠습니까?')) return;

    const id = user.id;
    const version = epoch;

    lock(true);

    try {
      const { data, error } = await db.from('jobs')
        .delete()
        .eq('id', job.id)
        .eq('owner_id', id)
        .select('id');

      if (error) throw error;

      if (data?.length !== 1) {
        throw Error('삭제 결과를 확인하지 못했습니다.');
      }

      if (
        user?.id === id &&
        epoch === version &&
        await refresh(id, version)
      ) {
        notify('공고가 삭제되었습니다.');
      }
    } catch (err) {
      if (user?.id === id && epoch === version) {
        notify('오류: ' + err.message);
      }
    } finally {
      lock(false);
    }
    return;
  }

  if (button.id === 'logout') {
    lock(true);

    try {
      const { error } = await db.auth.signOut();
      if (error) throw error;
    } catch (err) {
      notify('로그아웃 오류: ' + err.message);
    } finally {
      lock(false);
    }
  }
});

render();

if (db) {
  db.auth.onAuthStateChange((event, session) => {
    if (
      event === 'TOKEN_REFRESHED' ||
      event === 'USER_UPDATED'
    ) return;

    const next = session?.user || null;

    if (ready && user?.id === next?.id) return;

    const version = ++epoch;

    setTimeout(() => {
      void applySession(session, version);
    }, 0);
  });
}
