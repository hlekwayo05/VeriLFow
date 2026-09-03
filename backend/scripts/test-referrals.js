'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const jwt  = require('jsonwebtoken');
const http = require('http');
const pool = require('../db');

function apiRequest(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api' + path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(buf || '{}'); } catch { /* empty */ }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  const lecRes = await pool.query(
    `SELECT u.id FROM users u
     JOIN lecturer_modules lm ON lm.lecturer_id = u.id
     WHERE u.role = 'lecturer'
       AND lm.course = 'DICT - Diploma in ICT'
       AND UPPER(lm.module_code) = 'IS211'
     LIMIT 1`
  );
  const adminRes = await pool.query(
    `SELECT id FROM users WHERE email = 'veriflow@ump.ac.za'`
  );
  if (!adminRes.rows[0]) {
    throw new Error('Admin veriflow@ump.ac.za not found - run node seed.js');
  }
  if (!lecRes.rows[0]) {
    throw new Error('No lecturer with IS211 found - create one in User Management');
  }

  const lecToken = jwt.sign(
    { userId: lecRes.rows[0].id, role: 'lecturer', tempFlag: false },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );
  const adminToken = jwt.sign(
    { userId: adminRes.rows[0].id, role: 'admin', tempFlag: false },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

  const create = await apiRequest('POST', '/referrals', lecToken, {
    firstName: 'Test',
    surname: 'Referral',
    email: '230383025@ump.ac.za',
    course: 'DICT',
    moduleCode: 'IS211',
    qualificationLevel: '3rd year student',
  });
  console.log('CREATE', create.status, create.body);

  const list = await apiRequest('GET', '/referrals?status=pending', adminToken);
  console.log('LIST', list.status, Array.isArray(list.body) ? list.body.length + ' rows' : list.body);

  const id = create.body.referral && create.body.referral.id;
  if (id) {
    const approve = await apiRequest('PATCH', `/referrals/${id}/approve`, adminToken, {
      responsibilityLevel: 'standard',
    });
    console.log('APPROVE', approve.status, approve.body);
    await pool.query('DELETE FROM referrals WHERE id = $1', [id]);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
