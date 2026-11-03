
import { createHash, randomUUID } from 'node:crypto';

const PLANS = {
  week_7: { amount: 10000, name: '노가다ON 7일 광고' },
  month_30: { amount: 30000, name: '노가다ON 30일 광고' }
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST only' });
  }

  const url = process.env.VITE_SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const userid = process.env.PAYAPP_USERID;
  const linkkey = process.env.PAYAPP_LINKKEY;
  const requestkey = process.env.PAYAPP_REQUESTKEY;

  if (![url, anon, service, userid, linkkey, requestkey].every(Boolean)) {
    return res.status(503).json({ error: '서버 환경변수 누락' });
  }

  const dbHeaders = {
    apikey: service,
    Authorization: `Bearer ${service}`,
    'Content-Type': 'application/json'
  };

  const token = String(req.headers.authorization || '')
    .replace(/^Bearer\s+/i, '');

  if (!token) {
    return res.status(401).json({ error: '로그인이 필요합니다' });
  }

  let paymentId = null;

  try {
    const authRes = await fetch(`${url}/auth/v1/user`, {
      headers: {
        apikey: anon,
        Authorization: `Bearer ${token}`
      }
    });

    if (!authRes.ok) {
      return res.status(401).json({ error: '로그인이 만료되었습니다' });
    }

    const user = await authRes.json();
    const { ad_request_id, recvphone } = req.body || {};
    const phone = String(recvphone || '').replace(/\D/g, '');

    if (!UUID.test(String(ad_request_id || ''))) {
      return res.status(400).json({ error: '광고 신청번호 오류' });
    }

    if (!/^01[016789]\d{7,8}$/.test(phone)) {
      return res.status(400).json({ error: '휴대폰 번호 오류' });
    }

    const adRes = await fetch(
      `${url}/rest/v1/ad_requests?id=eq.${ad_request_id}&select=id,requester_id,plan_code,amount,status`,
      { headers: dbHeaders }
    );

    if (!adRes.ok) throw new Error('광고 신청 조회 실패');

    const ads = await adRes.json();
    const ad = ads[0];

    if (!ad || ad.requester_id !== user.id) {
      return res.status(403).json({ error: '본인 신청이 아닙니다' });
    }

    const plan = PLANS[ad.plan_code];

    if (!plan ||
        Number(ad.amount) !== plan.amount ||
        ad.status !== 'pending') {
      return res.status(409).json({
        error: '결제 가능한 광고 신청이 아닙니다'
      });
    }

    const orderId = randomUUID();

    const saveRes = await fetch(`${url}/rest/v1/ad_payments`, {
      method: 'POST',
      headers: {
        ...dbHeaders,
        Prefer: 'return=representation'
      },
      body: JSON.stringify({
        ad_request_id: ad.id,
        provider_order_id: orderId,
        provider: 'payapp',
        amount: plan.amount,
        status: 'created'
      })
    });

    if (saveRes.status === 409) {
      return res.status(409).json({
        error: '이미 결제 요청이 있습니다. 중복 결제를 확인하세요.'
      });
    }

    if (!saveRes.ok) throw new Error('결제 기록 생성 실패');

    const saved = await saveRes.json();
    paymentId = saved[0]?.id;

    if (!paymentId) throw new Error('결제 기록 ID 누락');

    // UTC 기준 14자리 시각. 페이앱 서버 허용 시간 내 사용.
    const requestdate = new Date().toISOString()
      .replace(/\D/g, '').slice(0, 14);

    const hash = createHash('sha256')
      .update(userid + requestdate + requestkey)
      .digest('hex');

    const params = new URLSearchParams({
      cmd: 'payrequest',
      userid,
      linkkey,
      requestdate,
      hash,
      goodname: plan.name,
      price: String(plan.amount),
      recvphone: phone,
      feedbackurl: 'https://nogadaon.vercel.app/api/payapp-feedback',
      returnurl: 'https://nogadaon.vercel.app/',
      var1: ad.id,
      var2: orderId,
      smsuse: 'n',
      checkretry: 'y'
    });

    const payRes = await fetch('https://api.payapp.kr/oapi/v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
      },
      body: params.toString(),
      signal: AbortSignal.timeout(15000)
    });

    if (!payRes.ok) throw new Error('페이앱 서버 오류');

    const result = new URLSearchParams(await payRes.text());
    const mulNo = result.get('mul_no');
    const rawPayUrl = result.get('payurl');

    if (result.get('state') !== '1' ||
        !/^\d+$/.test(mulNo || '') ||
        !rawPayUrl) {
      throw new Error(
        `페이앱 요청 실패: ${result.get('errorMessage') || '응답 오류'}`
      );
    }

    const paymentUrl = new URL(rawPayUrl);

    // 실제 결제 페이지는 HTTPS만 허용
    if (paymentUrl.protocol !== 'https:' ||
        !(
          paymentUrl.hostname === 'payapp.kr' ||
          paymentUrl.hostname.endsWith('.payapp.kr')
        )) {
      throw new Error('결제 URL 보안 검증 실패');
    }

    const updateRes = await fetch(
      `${url}/rest/v1/ad_payments?id=eq.${paymentId}&status=eq.created`,
      {
        method: 'PATCH',
        headers: {
          ...dbHeaders,
          Prefer: 'return=representation'
        },
        body: JSON.stringify({
          provider_transaction_id: mulNo,
          status: 'requested',
          updated_at: new Date().toISOString()
        })
      }
    );

    if (!updateRes.ok || (await updateRes.json()).length !== 1) {
      throw new Error('결제 거래번호 저장 실패');
    }

    return res.status(200).json({
      success: true,
      payurl: paymentUrl.href,
      order_id: orderId
    });

  } catch (error) {
    console.error('PayApp request error:', {
      message: error.message,
      paymentId
    });

    // 요청 성공 여부가 불명확할 때 자동 재시도를 허용하지 않음
    return res.status(503).json({
      error: '결제 요청을 확인할 수 없습니다. 중복 결제 방지를 위해 관리자 확인이 필요합니다.'
    });
  }
}
