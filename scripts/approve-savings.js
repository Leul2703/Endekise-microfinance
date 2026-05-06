const API_BASE = 'http://localhost:5000/api';
const ADMIN = { username: 'admin', password: 'Admin@Secure2026' };
const TARGET_ACCOUNT_ID = 'SA-MOP339I9-9W5';

async function run() {
  console.log('Logging in as admin...');
  let res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ADMIN)
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('Login failed:', data);
    process.exit(1);
  }
  const token = data.token;
  console.log('Logged in');

  console.log('Fetching pending approvals...');
  // Submit savings account for approval (create a savings_account_approval request)
  console.log('Submitting savings approval request...');
  await fetch(`${API_BASE}/savings/${TARGET_ACCOUNT_ID}/submit-approval`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({}) });

  console.log('Fetching pending approvals...');
  res = await fetch(`${API_BASE}/approvals/pending`, { headers: { Authorization: `Bearer ${token}` } });
  const approvals = await res.json();
  const target = approvals.find(a => a.entity_id === TARGET_ACCOUNT_ID || (a.details && String(a.details).includes && String(a.details).includes(TARGET_ACCOUNT_ID)));
  if (!target) {
    console.error('No pending approval found for', TARGET_ACCOUNT_ID);
    process.exit(1);
  }
  console.log('Found approval:', target.id, target.type, target.approval_level);

  console.log('Approving...');
  res = await fetch(`${API_BASE}/approvals/${target.id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ justification: 'Automated test approval' })
  });
  const approveRes = await res.json();
  console.log('Approve response:', approveRes);
}

run().catch(err => { console.error(err); process.exit(1); });
