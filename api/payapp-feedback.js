
import { timingSafeEqual } from 'node:crypto';

function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' ||
      !a || !b) return false;

  const x = Buffer.from(a);
  const y = Buffer.from(b);

  return x.length === y.length && timingSafeEqual(x, y);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    return res.status(200).json({
      service: 'payapp-feedback',
      configured: Boolean(
        process.env.PAYAPP_USERID &&
        process.env.PAYAPP_LINKKEY &&
        process.env.PAYAPP_LINKVAL &&
        process.env.SUPABASE_SERVICE_ROLE_KEY
      )
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).end('Method Not Allowed');
  }

  const { userid, linkkey, linkval, price,
          pay_state, mul_no, var1 } = req.body || {};

  if (!same(userid, process.env.PAYAPP_USERID) ||
      !same(linkkey, process.env.PAYAPP_LINKKEY) ||
      !same(linkval, process.env.PAYAPP_LINKVAL)) {
    return res.status(403).end('Verification failed');
  }

  if (!/^\d+$/.test(String(mul_no || '')) ||
      !/^[0-9a-f-]{36}$/i.test(String(var1 || ''))) {
    return res.status(400).end('Invalid payment reference');
  }

  if (!['10000', '30000'].includes(String(price))) {
    return res.status(400).end('Invalid amount');
  }

  if (String(pay_state) !== '4') {
    return res.status(200).end('SUCCESS');
  }

  // 결제 신청 ID, 거래번호, 금액과 DB 기록을
  // 원자적으로 대조하는 기능을 연결하기 전에는
  // 유료 광고를 활성화하지 않습니다.
  return res.status(503).end('Order verification pending');
}
