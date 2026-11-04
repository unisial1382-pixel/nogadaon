
import { timingSafeEqual } from 'node:crypto';

function same(a, b) {
  if (typeof a !== 'string' ||
      typeof b !== 'string' || !a || !b) {
    return false;
  }

  const x = Buffer.from(a);
  const y = Buffer.from(b);

  return x.length === y.length &&
    timingSafeEqual(x, y);
}

function parseBody(body) {
  if (typeof body === 'string') {
    return Object.fromEntries(new URLSearchParams(body));
  }

  if (body && typeof body === 'object' &&
      !Array.isArray(body)) {
    return body;
  }

  return {};
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    
  console.log('PayApp feedback GET check');

  return res.status(200).json({
  
      service: 'payapp-feedback',
      configured: Boolean(
        process.env.PAYAPP_USERID &&
        process.env.PAYAPP_LINKKEY &&
        process.env.PAYAPP_LINKVAL &&
        process.env.SUPABASE_SERVICE_ROLE_KEY &&
        process.env.VITE_SUPABASE_URL
      )
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).end('Method Not Allowed');
  }

  const data = parseBody(req.body);

  const {
    userid,
    linkkey,
    linkval,
    price,
    pay_state,
    mul_no,
    var1,
    var2
  } = data;

  if (
    !same(String(userid || ''), process.env.PAYAPP_USERID) ||
    !same(String(linkkey || ''), process.env.PAYAPP_LINKKEY) ||
    !same(String(linkval || ''), process.env.PAYAPP_LINKVAL)
  ) {
    return res.status(403).end('Verification failed');
  }

  if (
    !UUID.test(String(var1 || '')) ||
    !UUID.test(String(var2 || '')) ||
    !/^\d+$/.test(String(mul_no || '')) ||
    !['10000', '30000'].includes(String(price))
  ) {
    return res.status(400).end('Invalid payment reference');
  }

  if (String(pay_state) !== '4') {
    return res.status(200).end('SUCCESS');
  }

  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return res.status(503).end('Database not configured');
  }

  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json'
  };

  try {
    const filters = new URLSearchParams({
      select: 'id,status,amount',
      ad_request_id: `eq.${var1}`,
      provider_order_id: `eq.${var2}`,
      provider_transaction_id: `eq.${mul_no}`,
      provider: 'eq.payapp'
    });

    const found = await fetch(
      `${url}/rest/v1/ad_payments?${filters}`,
      { headers }
    );

    if (!found.ok) {
      throw new Error('Payment lookup failed');
    }

    const rows = await found.json();

    if (
      rows.length !== 1 ||
      Number(rows[0].amount) !== Number(price)
    ) {
      return res.status(409).end('Order mismatch');
    }

    
    if (!['requested', 'paid'].includes(rows[0].status)) {
      return res.status(409).end('Invalid order status');
    }

    const activated = await fetch(
      `${url}/rest/v1/rpc/complete_payapp_ad_payment`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          p_payment_id: rows[0].id,
          p_order_id: String(var2),
          p_transaction_id: String(mul_no),
          p_amount: Number(price)
        })
      }
    );

    if (!activated.ok || (await activated.json()) !== true) {
      throw new Error('Payment activation failed');
    }

    return res.status(200).end('SUCCESS');


  } catch (error) {
    console.error(
      'PayApp feedback error:',
      error.message
    );

    return res.status(503).end('Processing failed');
  }
}
