'use strict';

/**
 * End-to-end smoke test for the tutor application flow:
 * register → academic save → submit (with sample PDFs)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs   = require('fs');
const path = require('path');

const API = `http://localhost:${process.env.PORT || 3000}/api`;

async function request(pathname, { method = 'GET', token, json, formData } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: formData || (json ? JSON.stringify(json) : undefined),
  });

  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, ok: res.ok, data };
}

function minimalPdf(text) {
  const escaped = text.replace(/[()\\]/g, '\\$&');
  const stream = `BT /F1 12 Tf 50 700 Td (${escaped}) Tj ET`;
  return Buffer.from(
    `%PDF-1.4
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>endobj
4 0 obj<< /Length ${stream.length} >>stream
${stream}
endstream endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000306 00000 n 
trailer<< /Size 5 /Root 1 0 R >>
startxref
400
%%EOF`
  );
}

function buildTranscriptPdf({ modules, average }) {
  const blocks = modules.map(m => `
Year: 2024
Subject: ${m.code} ${m.name}
Academic Period: Semester 1
Final Mark: ${m.mark}
Result: ${m.result}
`).join('\n');
  return minimalPdf(`${blocks}\nAverage: ${average}`);
}

function buildCvPdf() {
  return minimalPdf(
    'Curriculum Vitae. Skills: programming, database, SQL, networking, data structures, algorithms, systems analysis.'
  );
}

async function main() {
  const stamp = Date.now();
  const email = `test.tutor.${stamp}@ump.ac.za`;
  const studentNumber = String(900000000 + (stamp % 100000000));

  console.log('1. Register (step 1)...');
  const reg = await request('/auth/register', {
    method: 'POST',
    json: {
      surname: 'Test',
      title: 'Mr',
      initials: 'T T',
      firstNames: 'Test Tutor',
      email,
      cell: '0821234567',
      studentNumber,
      password: 'TestPass123',
      confirm: 'TestPass123',
    },
  });
  if (!reg.ok) throw new Error(`Register failed (${reg.status}): ${JSON.stringify(reg.data)}`);
  const token = reg.data.token;
  console.log('   OK — userId', reg.data.userId);

  console.log('2. Save academic info (step 2)...');
  const academic = await request('/applications/me/academic', {
    method: 'PATCH',
    token,
    json: {
      faculty: 'Information & Communication Technology',
      course: 'BICT — Bachelor of ICT',
      qualificationLevel: '3rd_year',
      moduleYearLevel: '3rd Year',
      moduleName: 'Programming',
      gpa: 78,
    },
  });
  if (!academic.ok) throw new Error(`Academic save failed (${academic.status}): ${JSON.stringify(academic.data)}`);
  console.log('   OK');

  console.log('3. Submit application (step 3)...');
  const tmpDir = path.join(__dirname, '../uploads');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const cvPath = path.join(tmpDir, `test_cv_${stamp}.pdf`);
  const transcriptPath = path.join(tmpDir, `test_transcript_${stamp}.pdf`);

  fs.writeFileSync(cvPath, buildCvPdf());
  fs.writeFileSync(
    transcriptPath,
    buildTranscriptPdf({
      average: 78,
      modules: [
        { code: 'PRG301', name: 'PROGRAMMING', mark: 78, result: 'Pass' },
      ],
    })
  );

  const form = new FormData();
  form.append('cvFile', new Blob([fs.readFileSync(cvPath)], { type: 'application/pdf' }), 'cv.pdf');
  form.append('transcriptFile', new Blob([fs.readFileSync(transcriptPath)], { type: 'application/pdf' }), 'transcript.pdf');
  form.append('declared', 'true');

  const submit = await request('/applications/me/submit', {
    method: 'POST',
    token,
    formData: form,
  });
  if (!submit.ok && submit.status !== 200) {
    throw new Error(`Submit failed (${submit.status}): ${JSON.stringify(submit.data)}`);
  }
  console.log('   Result:', submit.data.status, submit.data.pass ? '(passed)' : '(rejected)');
  if (submit.data.reason) console.log('   Reason:', submit.data.reason);

  console.log('4. Fetch application status...');
  const me = await request('/applications/me', { token });
  if (!me.ok) throw new Error(`GET /me failed (${me.status}): ${JSON.stringify(me.data)}`);
  console.log('   Status:', me.data.status);
  console.log('   Module:', me.data.module_name);
  console.log('   CV score:', me.data.cv_keyword_score);

  console.log('5. Login routing data...');
  const login = await request('/auth/login', {
    method: 'POST',
    json: { email, password: 'TestPass123' },
  });
  if (!login.ok) throw new Error(`Login failed (${login.status}): ${JSON.stringify(login.data)}`);
  console.log('   applicationStatus:', login.data.applicationStatus);

  if (submit.data.pass && me.data.status !== 'submitted') {
    throw new Error(`Expected status "submitted", got "${me.data.status}"`);
  }
  if (!submit.data.pass && me.data.status !== 'rejected') {
    throw new Error(`Expected status "rejected", got "${me.data.status}"`);
  }

  if (submit.data.pass) {
    console.log('\nApplication flow test passed (eligible submission).');
  } else {
    console.log('\nApplication flow test passed (rejection path).');
    console.log('   Detail:', submit.data.detail);
  }
}

main().catch(err => {
  console.error('\nApplication flow test FAILED:', err.message);
  process.exit(1);
});
