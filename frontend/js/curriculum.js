'use strict';

/**
 * VeriFlow - Official curriculum (modules by course and year/semester).
 * Keep in sync with backend/constants.js
 */
const CURRICULUM = {
  'DICT - Diploma in ICT': {
    '1st Year - Semester 1': [
      { code: 'COM100',  name: 'Professional Communication 100' },
      { code: 'DICT121', name: 'Computing Theory 121' },
      { code: 'DICT131', name: 'Multimedia Fundamentals 131' },
      { code: 'DICT151', name: 'Programming Fundamentals 151' },
      { code: 'DICT111', name: 'Information Systems 111' },
    ],
    '1st Year - Semester 2': [
      { code: 'DICT112', name: 'Communication Network Fundamentals 112' },
      { code: 'DICT122', name: 'Programming Fundamentals 122' },
      { code: 'DICT132', name: 'Multimedia Fundamentals 132' },
      { code: 'DICT142', name: 'Business Practice 142' },
      { code: 'STAT101', name: 'Basic Statistics 101' },
    ],
    '2nd Year - Semester 1': [
      { code: 'DICT211', name: 'Application Development 211' },
      { code: 'DICT221', name: 'Software Development 221' },
      { code: 'DICT231', name: 'IT Service Management 231' },
      { code: 'DICT241', name: 'Information Systems 241' },
    ],
    '2nd Year - Semester 2': [
      { code: 'DICT222', name: 'Application Development 222' },
      { code: 'DICT232', name: 'Communication Network 232' },
      { code: 'DICT242', name: 'Multimedia Applications 242' },
      { code: 'DICT252', name: 'IT Project Management 252' },
    ],
    '3rd Year - Semester 1': [
      { code: 'DICT311', name: 'Application Development 311' },
      { code: 'DICT321', name: 'Information Systems 321' },
    ],
    '3rd Year - Semester 2': [
      { code: 'DICT312', name: 'Application Development 312' },
      { code: 'DICT322', name: 'Information Systems 322' },
    ],
    'Year Block': [
      { code: 'DICT300', name: 'Project 300' },
    ],
  },
  'BICT - Bachelor of ICT': {
    '1st Year - Semester 1': [
      { code: 'ALP101', name: 'Academic Literacy and Professional Development for ICT 101' },
      { code: 'DBF101', name: 'Introduction to Databases 101' },
      { code: 'MFC101', name: 'Mathematics for Computing 101' },
      { code: 'PRT101', name: 'Introduction to Programming Techniques 101' },
      { code: 'CNT101', name: 'Introduction Communication Networking 101' },
    ],
    '1st Year - Semester 2': [
      { code: 'CPP102', name: 'Computing Professional Practice 102' },
      { code: 'MFC102', name: 'Mathematics for Computing 102' },
      { code: 'OSF102', name: 'Introduction to Operating Systems 102' },
      { code: 'PRT102', name: 'Programming Techniques 102' },
      { code: 'CNT102', name: 'Communication Networking 102' },
    ],
    '2nd Year - Semester 1': [
      { code: 'PRT201', name: 'Programming Techniques 201' },
      { code: 'WDV201', name: 'Introduction to Web Development 201' },
      { code: 'PSE201', name: 'Principles of Software Engineering 201' },
      { code: 'DBS201', name: 'Database Systems 201' },
      { code: 'STF201', name: 'Statistics for Information Communication Technology 201' },
    ],
    '2nd Year - Semester 2': [
      { code: 'CYB202', name: 'Cybersecurity 202' },
      { code: 'MDT202', name: 'Mobile Application Development Techniques 202' },
      { code: 'IOT202', name: 'Introduction to the Internet of Things 202' },
      { code: 'DSA202', name: 'Data Structures and Algorithms 202' },
      { code: 'DSA202B', name: 'Data Scalability and Analytics 202' },
    ],
    '3rd Year - Semester 1': [
      { code: 'PRJ300', name: 'Project 300' },
      { code: 'IPM301', name: 'Information Technology Project Management 301' },
      { code: 'DAN301', name: 'Data Analytics 301' },
    ],
    '3rd Year - Semester 2': [
      { code: 'CYB302', name: 'Cybersecurity 302' },
      { code: 'PRG301', name: 'Programming Techniques 301' },
      { code: 'CNT302', name: 'Communication Networks 302' },
    ],
  },
};

function curriculumYearSemesters(course) {
  return Object.keys(CURRICULUM[course] || {});
}

function curriculumModulesForYear(course, yearSem) {
  return (CURRICULUM[course] || {})[yearSem] || [];
}

function curriculumModulesForCourse(course) {
  const seen = new Map();
  Object.values(CURRICULUM[course] || {}).flat().forEach(m => {
    if (!seen.has(m.code)) seen.set(m.code, m);
  });
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function findCurriculumModuleByName(course, name) {
  for (const list of Object.values(CURRICULUM[course] || {})) {
    const hit = list.find(m => m.name === name);
    if (hit) return hit;
  }
  return null;
}

function moduleSelectOptionHtml(mod) {
  const esc = s => String(s).replace(/"/g, '&quot;');
  return `<option value="${esc(mod.name)}" data-code="${esc(mod.code)}">${mod.name}</option>`;
}

function readModuleCodeFromSelect(selectEl) {
  if (!selectEl || selectEl.selectedIndex < 0) return '';
  return selectEl.options[selectEl.selectedIndex].dataset.code || '';
}

function renderCurriculumModuleList(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  let html = '';
  Object.entries(CURRICULUM).forEach(([course, semesters]) => {
    html += `<div style="margin-bottom:14px;"><div style="font-weight:600;font-size:13px;margin-bottom:6px;color:var(--text);">${course}</div>`;
    Object.entries(semesters).forEach(([sem, modules]) => {
      html += `<div style="font-size:11px;color:var(--muted);margin:6px 0 4px;font-family:'DM Mono',monospace;">${sem}</div>`;
      html += '<ul style="margin:0 0 4px 16px;padding:0;list-style:disc;">';
      modules.forEach(m => {
        html += `<li style="font-size:12px;color:var(--text);margin-bottom:2px;"><span style="font-family:'DM Mono',monospace;">${m.code}</span> - ${m.name}</li>`;
      });
      html += '</ul>';
    });
    html += '</div>';
  });
  el.innerHTML = html;
}
