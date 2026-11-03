
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    return res.status(200).json({
      service: 'payapp-feedback',
      configured: false
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).end('Method Not Allowed');
  }

  // 결제 검증 기능을 연결하기 전까지
  // 광고를 활성화하지 않습니다.
  return res.status(503).end(
    'Payment verification not configured'
  );
}
