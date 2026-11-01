
import {createClient} from '@supabase/supabase-js';
import './style.css';

const url=import.meta.env.VITE_SUPABASE_URL,key=import.meta.env.VITE_SUPABASE_ANON_KEY;
const db=url&&key?createClient(url,key):null;
const app=document.querySelector('#app');

let user=null,profile=null,tab='jobs',jobs=[];

const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const won=n=>Number(n).toLocaleString('ko-KR')+'원';
const status=t=>document.querySelector('#notice')?.replaceChildren(document.createTextNode(t));
const q=id=>document.getElementById(id);
const opt=values=>values.map(v=>`<option value="${safe(v)}">${safe(v)}</option>`).join('');
const areas=['수원','화성','기흥','동탄','평택','기타'];

function layout(content){
  app.innerHTML=`<header><strong>👷 노가다ON</strong><small>건설 구인구직 · 인력사무소</small></header><main><div id="notice" role="status"></div>${content}</main>`;
}

function nav(){
  return `<nav>${[
    ['jobs','일자리'],
    ['post','공고등록'],
    ['account','내 계정']
  ].map(([id,label])=>`<button data-tab="${id}" class="${tab===id?'active':''}">${label}</button>`).join('')}</nav>`;
}

function allowedCompany(){
  return !!user&&['company','agency'].includes(profile?.role);
}

function render(){
  if(!db){
    layout('<section><h2>서비스 연결 대기</h2><p>Supabase 프로젝트 연결이 필요합니다.</p></section>');
    return;
  }

  if(!user){
    layout(`<section><h2>회원가입 · 로그인</h2>
      <form id="auth">
        <label>이메일<input name="email" type="email" required autocomplete="email"></label>
        <label>비밀번호<input name="password" type="password" required minlength="8"></label>
        <label>가입 유형
          <select name="role">
            <option value="worker">구직자</option>
            <option value="company">건설업체</option>
            <option value="agency">인력사무소</option>
          </select>
        </label>
        <div class="actions">
          <button name="mode" value="login">로그인</button>
          <button name="mode" value="signup">회원가입</button>
        </div>
      </form>
      <p class="muted">이메일 인증 후 로그인할 수 있습니다.</p>
    </section>`);
    return;
  }

  let content='';

  if(tab==='jobs'){
    content=`<section>
      <h2>현장 일자리</h2>
      <input id="search" placeholder="직종·지역 검색">
      <div id="joblist">${jobCards(jobs)}</div>
    </section>`;
  }

  if(tab==='post'){
    content=`<section>
      <h2>구인공고 등록</h2>
      ${allowedCompany()?`
        <form id="post">
          <label>공고 제목<input name="title" required maxlength="120"></label>
          <label>근무 지역<select name="region">${opt(areas)}</select></label>
          <label>일당(원)<input name="daily_pay" type="number" min="1" required></label>
          <label>모집인원<input name="slots" type="number" min="1" required></label>
          <label>담당자 전화번호<input name="contact_phone" type="tel" placeholder="010-1234-5678" required></label>
          <label>상세 설명<textarea name="description" maxlength="2000"></textarea></label>
          <button>공고 등록</button>
        </form>
      `:'<p>건설업체 또는 인력사무소 계정으로 로그인해 주세요.</p>'}
    </section>`;
  }

  if(tab==='account'){
    content=`<section>
      <h2>내 계정</h2>
      <p>${safe(user.email)}</p>
      <p>유형: ${safe(profile?.role||'설정 중')}</p>
      <button id="logout">로그아웃</button>
    </section>`;
  }

  layout(nav()+content);
}

function jobCards(data){
  return data.map(j=>`
    <article>
      <span class="pill">${safe(j.region)}</span>
      <h3>${safe(j.title)}</h3>
      <p>일당 <b>${won(j.daily_pay)}</b> · ${j.slots}명</p>
      <p>${safe(j.description||'')}</p>
      ${j.contact_phone?`
        <p>담당자 전화번호: ${safe(j.contact_phone)}</p>
        <a href="tel:${safe(String(j.contact_phone).replace(/[^0-9+]/g,''))}">📞 전화하기</a>
      `:'<p>전화번호 미등록</p>'}
    </article>
  `).join('')||'<p>등록된 공고가 없습니다.</p>';
}

async function refresh(){
  if(!user)return;
  const {data,error}=await db.from('jobs')
    .select('*')
    .eq('status','open')
    .order('created_at',{ascending:false});
  if(error)console.warn(error.message);
  jobs=data||[];
  render();
}

async function loadProfile(){
  const {data,error}=await db.from('profiles')
    .select('*')
    .eq('id',user.id)
    .single();
  profile=data;
  if(error)console.warn(error.message);
}

document.addEventListener('submit',async e=>{
  e.preventDefault();
  const f=e.target;
  const d=Object.fromEntries(new FormData(f));

  try{
    if(f.id==='auth'){
      const mode=e.submitter?.value||'login';
      const result=mode==='signup'
        ?await db.auth.signUp({
          email:d.email,
          password:d.password,
          options:{data:{role:d.role}}
        })
        :await db.auth.signInWithPassword({
          email:d.email,
          password:d.password
        });

      if(result.error)throw result.error;
      status(mode==='signup'
        ?'가입 요청 완료. 이메일 인증 후 로그인하세요.'
        :'로그인 완료');
      return;
    }

    if(f.id==='post'){
      if(!allowedCompany()){
        throw Error('건설업체 또는 인력사무소 계정이 필요합니다.');
      }

      const {error}=await db.from('jobs').insert({
        owner_id:user.id,
        title:d.title,
        region:d.region,
        daily_pay:+d.daily_pay,
        slots:+d.slots,
        contact_phone:d.contact_phone,
        description:d.description
      });

      if(error)throw error;
      tab='jobs';
    }

    await refresh();
    status('저장되었습니다.');
  }catch(err){
    status('오류: '+err.message);
  }
});

document.addEventListener('input',e=>{
  if(e.target.id==='search'){
    const t=e.target.value.toLowerCase();
    q('joblist').innerHTML=jobCards(
      jobs.filter(j=>(j.title+' '+j.region).toLowerCase().includes(t))
    );
  }
});

document.addEventListener('click',async e=>{
  const b=e.target.closest('button');
  if(!b)return;

  try{
    if(b.dataset.tab){
      tab=b.dataset.tab;
      render();
    }
    if(b.id==='logout'){
      await db.auth.signOut();
    }
  }catch(err){
    status('오류: '+err.message);
  }
});

if(db){
  db.auth.onAuthStateChange(async(_event,session)=>{
    user=session?.user||null;
    profile=null;
    if(user){
      await loadProfile();
      await refresh();
    }else{
      render();
    }
  });
}else{
  render();
}
