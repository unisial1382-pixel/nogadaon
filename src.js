
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
let regionFilter = '';
let womenOnly = false;
let beginnerOnly = false;
let payOnly = false;
let paidAds = [];
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

const mediaUrl = path =>
  db.storage.from('job-media').getPublicUrl(path).data.publicUrl;

function mediaView(j) {
  return (Array.isArray(j.media) ? j.media : [])
    .map(m => {
      const src = safe(mediaUrl(m.path));
      return m.type === 'video'
        ? `<video controls playsinline
            style="width:100%" src="${src}"></video>`
        : `<img loading="lazy" alt="현장 사진"
            style="width:100%" src="${src}">`;
    }).join('');
}
  
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

  return jobs.filter(j => {
    const desc = String(j.description || '');
    const text = [j.title, j.region, desc]
      .join(' ').toLowerCase();

    const women = /여성\s*(지원\s*)?(가능|환영)|여자\s*(가능|환영)|여성\s*우대/i;
    const beginner = /초보\s*(지원\s*)?(가능|환영)|초보자\s*(가능|환영)|경력\s*무관|무경력\s*가능/i;

    return (!term || text.includes(term))
      && (!regionFilter || j.region === regionFilter)
      && (!womenOnly || women.test(desc))
      && (!beginnerOnly || beginner.test(desc))
      && (!payOnly || Number(j.daily_pay) >= 150000);
  });
}
function adCards() {
  const pool = paidAds
    .filter(a => jobs.some(j => j.id === a.job_id))
    .map(a => ({
      ...a,
      weight: Number(a.ad_plans?.rotation_weight || 1)
    }));

  const selected = [];

  while (pool.length && selected.length < 3) {
    const total = pool.reduce((s, a) => s + a.weight, 0);
    let pick = Math.random() * total;
    let index = 0;

    for (; index < pool.length - 1; index++) {
      pick -= pool[index].weight;
      if (pick < 0) break;
    }

    selected.push(pool.splice(index, 1)[0]);
  }

  if (!selected.length) return '';

  const featured = selected
    .map(a => jobs.find(j => j.id === a.job_id))
    .filter(Boolean);

  return `
    <section>
      <h2>⭐ 유료 상단 광고</h2>
      <p class="muted">광고 · 유료 프로모션</p>
    </section>
    ${cards(featured)}
  `;
}

async function fetchAds() {
  const now = new Date().toISOString();

  const { data, error } = await db
    .from('job_ads')
    .select('job_id,plan_code,ad_plans(rotation_weight)')
    .eq('active', true)
    .lte('starts_at', now)
    .gt('ends_at', now);

  if (error) throw error;
  return data || [];
}
function cards(items) {
  return items.map(j => `
    <article>
      <span class="pill">${safe(j.region)}</span>
      <h3>${safe(j.title)}</h3>
        ${mediaView(j)}


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
        
<label>
  현장 사진 (무료 최대 3장 · 유료 최대 5장)
  <input
    name="photos"
    type="file"
    accept="image/jpeg,image/png,image/webp"
    multiple>
</label>

<label>
  현장 동영상 (유료 광고만 · 최대 30초)
  <input
    name="video"
    type="file"
    accept="video/mp4,video/webm,video/quicktime">
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
              <label>지역 선택
          <select id="regionFilter">
            <option value="">전체 지역</option>
            ${areas.map(r => `<option value="${safe(r)}" ${regionFilter === r ? 'selected' : ''}>${safe(r)}</option>`).join('')}
          </select>
        </label>

        <div class="filter-options">
          <label><input type="checkbox" id="womenOnly" ${womenOnly ? 'checked' : ''}> 여성 가능</label>
          <label><input type="checkbox" id="beginnerOnly" ${beginnerOnly ? 'checked' : ''}> 초보 가능</label>
          <label><input type="checkbox" id="payOnly" ${payOnly ? 'checked' : ''}> 일당 15만 원 이상</label>
        </div>
        <p class="muted">여성·초보 조건은 상세 설명을 기준으로 검색합니다.</p>
      </section>
      <div id="paidAds">${adCards()}</div>
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
  const [list, ads] = await Promise.all([
  fetchJobs(),
  fetchAds()
]);

  if (user?.id !== id || epoch !== version) return false;

  jobs = list;
paidAds = ads;
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
    const [pr, js,ads] = await Promise.all([
      db.from('profiles')
        .select('id,role')
        .eq('id', next.id)
        .maybeSingle(),
      fetchJobs(),
fetchAds()
    ]);

    if (pr.error) throw pr.error;
    if (user?.id !== next.id || epoch !== version) return;

    profile = pr.data;
    jobs = js;
paidAds = ads;
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
     
    const photos = [...(form.elements.namedItem('photos')?.files || [])];
    const video = form.elements.namedItem('video')?.files?.[0];
    const existing = Array.isArray(edit?.media) ? edit.media : [];

    const paid = edit
      ? paidAds.some(a => a.job_id === edit.id)
      : false;

    const maxPhotos = paid ? 5 : 3;
    const photoCount = existing.filter(m => m.type === 'image').length;

    if (photoCount + photos.length > maxPhotos) {
      throw Error(`사진은 최대 ${maxPhotos}장까지 가능합니다.`);
    }

    if (video && !paid) {
      throw Error('동영상은 유료 광고 공고에서만 등록할 수 있습니다.');
    }

    if (video && existing.some(m => m.type === 'video')) {
      throw Error('동영상은 1개만 등록할 수 있습니다.');
    }

    const mediaFiles = [
      ...photos.map(file => ({ file, type: 'image' })),
      ...(video ? [{ file: video, type: 'video' }] : [])
    ];

    for (const { file, type } of mediaFiles) {
      const allowed = type === 'image'
        ? ['image/jpeg', 'image/png', 'image/webp']
        : ['video/mp4', 'video/webm', 'video/quicktime'];

      const maxSize = type === 'image' ? 5 : 30;

      if (!allowed.includes(file.type) ||
          file.size > maxSize * 1024 * 1024) {
        throw Error('파일 형식 또는 용량을 확인하세요.');
      }

      if (type === 'video') {
        const duration = await new Promise((resolve, reject) => {
          const player = document.createElement('video');
          const tempUrl = URL.createObjectURL(file);

          player.preload = 'metadata';
          player.onloadedmetadata = () => {
            const seconds = player.duration;
            URL.revokeObjectURL(tempUrl);
            resolve(seconds);
          };
          player.onerror = () => {
            URL.revokeObjectURL(tempUrl);
            reject(Error('영상 파일을 읽을 수 없습니다.'));
          };
          player.src = tempUrl;
        });

        if (!Number.isFinite(duration) || duration > 30) {
          throw Error('동영상은 최대 30초까지 가능합니다.');
        }
      }
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
    
    const jobId = data[0].id;
    const uploaded = [];

    try {
      for (const { file, type } of mediaFiles) {
        const ext = file.name.split('.').pop().toLowerCase();
        const path = `${id}/${jobId}/${crypto.randomUUID()}.${ext}`;

        const { error: uploadError } = await db.storage
          .from('job-media')
          .upload(path, file, {
            contentType: file.type,
            upsert: false
          });

        if (uploadError) throw uploadError;

        uploaded.push({ path, type });
      }

      if (uploaded.length) {
        const { data: saved, error: mediaError } = await db
          .from('jobs')
          .update({ media: [...existing, ...uploaded] })
          .eq('id', jobId)
          .eq('owner_id', id)
          .select('id');

        if (mediaError) throw mediaError;

        if (saved?.length !== 1) {
          throw Error('파일 정보를 저장하지 못했습니다.');
        }
      }
    } catch (uploadError) {
      if (uploaded.length) {
        await db.storage
          .from('job-media')
          .remove(uploaded.map(m => m.path));
      }

      throw Error(
        '공고는 저장됐지만 파일 업로드에 실패했습니다: ' +
        uploadError.message
      );
    }

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
document.addEventListener('change', e => {
  const id = e.target.id;

  if (!['regionFilter', 'womenOnly', 'beginnerOnly', 'payOnly'].includes(id)) return;

  if (id === 'regionFilter') regionFilter = e.target.value;
  if (id === 'womenOnly') womenOnly = e.target.checked;
  if (id === 'beginnerOnly') beginnerOnly = e.target.checked;
  if (id === 'payOnly') payOnly = e.target.checked;

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
