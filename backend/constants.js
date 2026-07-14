/**
 * VeriFlow — Server-side constants
 *
 * Two sources of truth:
 *   1. CURRICULUM  — valid modules per course and year level
 *   2. RATE_TABLE  — 2026 tutor payment rates
 *
 * These values are used by:
 *   - The eligibility check (POST /api/applications/me/submit)
 *   - The claims calculator (POST /api/claims)
 *   - Validation on academic info save (PATCH /api/applications/me/academic)
 *
 * Do NOT modify these unless the client provides an updated rate table
 * or curriculum change. These must stay in sync with apply-step2.html.
 */

'use strict';

// =============================================================
//  1. CURRICULUM
//  Structure: CURRICULUM[course][yearSemester] = { code, name }[]
//
//  Used to validate that the module submitted in step 2
//  actually exists for the selected course and year level.
// =============================================================

const CURRICULUM = {

  'DICT — Diploma in ICT': {
    '1st Year — Semester 1': [
      { code: 'COM100',  name: 'Professional Communication 100' },
      { code: 'DICT121', name: 'Computing Theory 121' },
      { code: 'DICT131', name: 'Multimedia Fundamentals 131' },
      { code: 'DICT151', name: 'Programming Fundamentals 151' },
      { code: 'DICT111', name: 'Information Systems 111' },
    ],
    '1st Year — Semester 2': [
      { code: 'DICT112', name: 'Communication Network Fundamentals 112' },
      { code: 'DICT122', name: 'Programming Fundamentals 122' },
      { code: 'DICT132', name: 'Multimedia Fundamentals 132' },
      { code: 'DICT142', name: 'Business Practice 142' },
      { code: 'STAT101', name: 'Basic Statistics 101' },
    ],
    '2nd Year — Semester 1': [
      { code: 'DICT211', name: 'Application Development 211' },
      { code: 'DICT221', name: 'Software Development 221' },
      { code: 'DICT231', name: 'IT Service Management 231' },
      { code: 'DICT241', name: 'Information Systems 241' },
    ],
    '2nd Year — Semester 2': [
      { code: 'DICT222', name: 'Application Development 222' },
      { code: 'DICT232', name: 'Communication Network 232' },
      { code: 'DICT242', name: 'Multimedia Applications 242' },
      { code: 'DICT252', name: 'IT Project Management 252' },
    ],
    '3rd Year — Semester 1': [
      { code: 'DICT311', name: 'Application Development 311' },
      { code: 'DICT321', name: 'Information Systems 321' },
    ],
    '3rd Year — Semester 2': [
      { code: 'DICT312', name: 'Application Development 312' },
      { code: 'DICT322', name: 'Information Systems 322' },
    ],
    'Year Block': [
      { code: 'DICT300', name: 'Project 300' },
    ],
  },

  'BICT — Bachelor of ICT': {
    '1st Year — Semester 1': [
      { code: 'ALP101', name: 'Academic Literacy and Professional Development for ICT 101' },
      { code: 'DBF101', name: 'Introduction to Databases 101' },
      { code: 'MFC101', name: 'Mathematics for Computing 101' },
      { code: 'PRT101', name: 'Introduction to Programming Techniques 101' },
      { code: 'CNT101', name: 'Introduction Communication Networking 101' },
    ],
    '1st Year — Semester 2': [
      { code: 'CPP102', name: 'Computing Professional Practice 102' },
      { code: 'MFC102', name: 'Mathematics for Computing 102' },
      { code: 'OSF102', name: 'Introduction to Operating Systems 102' },
      { code: 'PRT102', name: 'Programming Techniques 102' },
      { code: 'CNT102', name: 'Communication Networking 102' },
    ],
    '2nd Year — Semester 1': [
      { code: 'PRT201', name: 'Programming Techniques 201' },
      { code: 'WDV201', name: 'Introduction to Web Development 201' },
      { code: 'PSE201', name: 'Principles of Software Engineering 201' },
      { code: 'DBS201', name: 'Database Systems 201' },
      { code: 'STF201', name: 'Statistics for Information Communication Technology 201' },
    ],
    '2nd Year — Semester 2': [
      { code: 'CYB202', name: 'Cybersecurity 202' },
      { code: 'MDT202', name: 'Mobile Application Development Techniques 202' },
      { code: 'IOT202', name: 'Introduction to the Internet of Things 202' },
      { code: 'DSA202', name: 'Data Structures and Algorithms 202' },
      { code: 'DSA202B', name: 'Data Scalability and Analytics 202' },
    ],
    '3rd Year — Semester 1': [
      { code: 'PRJ300', name: 'Project 300' },
      { code: 'IPM301', name: 'Information Technology Project Management 301' },
      { code: 'DAN301', name: 'Data Analytics 301' },
    ],
    '3rd Year — Semester 2': [
      { code: 'CYB302', name: 'Cybersecurity 302' },
      { code: 'PRG301', name: 'Programming Techniques 301' },
      { code: 'CNT302', name: 'Communication Networks 302' },
    ],
  },

};

// Flat list of all valid courses — used for course-level validation
const VALID_COURSES = Object.keys(CURRICULUM);

const ELECTIVE_MODULES = new Set([]);

function normalizeCurriculumText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[—–−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveCourseKey(course) {
  if (!course) return null;
  if (CURRICULUM[course]) return course;

  const norm = normalizeCurriculumText(course);
  const exact = VALID_COURSES.find(c => normalizeCurriculumText(c) === norm);
  if (exact) return exact;

  if (norm.includes('dict')) return 'DICT — Diploma in ICT';
  if (norm.includes('bict')) return 'BICT — Bachelor of ICT';
  return null;
}

function resolveYearSemesterKey(courseKey, yearLevel) {
  if (!courseKey || !yearLevel) return null;
  const keys = Object.keys(CURRICULUM[courseKey] || {});
  if (keys.includes(yearLevel)) return yearLevel;

  const norm = normalizeCurriculumText(yearLevel);
  const exact = keys.find(k => normalizeCurriculumText(k) === norm);
  if (exact) return exact;

  // Accept common variants e.g. "first year semester 1" → "1st Year — Semester 1"
  const fuzzy = keys.find(k => {
    const kn = normalizeCurriculumText(k);
    return kn === norm
      || kn.replace(/1st/g, 'first') === norm.replace(/1st/g, 'first')
      || kn.replace(/2nd/g, 'second') === norm.replace(/2nd/g, 'second')
      || kn.replace(/3rd/g, 'third') === norm.replace(/3rd/g, 'third');
  });
  return fuzzy || null;
}

function getYearLevels(course) {
  const courseKey = resolveCourseKey(course);
  return Object.keys(CURRICULUM[courseKey] || {});
}

function getModuleObjects(course, yearLevel) {
  const courseKey = resolveCourseKey(course);
  const yearKey   = resolveYearSemesterKey(courseKey, yearLevel);
  if (!courseKey || !yearKey) return [];
  return CURRICULUM[courseKey][yearKey] || [];
}

function getModules(course, yearLevel) {
  return getModuleObjects(course, yearLevel).map(m => m.name);
}

function findCurriculumModule(course, yearLevel, moduleName, moduleCode) {
  const courseKey = resolveCourseKey(course);
  if (!courseKey) return null;

  const name = String(moduleName || '').trim();
  const code = String(moduleCode || '').trim().toUpperCase();

  const yearKey = resolveYearSemesterKey(courseKey, yearLevel);
  const buckets = yearKey
    ? [[yearKey, CURRICULUM[courseKey][yearKey] || []]]
    : Object.entries(CURRICULUM[courseKey]).map(([yk, list]) => [yk, list]);

  for (const [yk, list] of buckets) {
    if (name && code) {
      const both = list.find(m => m.name === name && m.code.toUpperCase() === code);
      if (both) return { courseKey, yearKey: yk, mod: both };
    }
    if (name) {
      const byName = list.find(m => m.name === name);
      if (byName) return { courseKey, yearKey: yk, mod: byName };
    }
    if (code) {
      const byCode = list.find(m => m.code.toUpperCase() === code);
      if (byCode) return { courseKey, yearKey: yk, mod: byCode };
    }
  }

  if (yearKey) {
    for (const [yk, list] of Object.entries(CURRICULUM[courseKey])) {
      if (yk === yearKey) continue;
      if (name) {
        const byName = list.find(m => m.name === name);
        if (byName) return { courseKey, yearKey: yk, mod: byName };
      }
      if (code) {
        const byCode = list.find(m => m.code.toUpperCase() === code);
        if (byCode) return { courseKey, yearKey: yk, mod: byCode };
      }
    }
  }
  return null;
}

function isValidModule(course, yearLevel, moduleName) {
  return !!findCurriculumModule(course, yearLevel, moduleName, null);
}

function getModuleCode(course, yearLevel, moduleName) {
  const hit = findCurriculumModule(course, yearLevel, moduleName, null);
  return hit ? hit.mod.code : null;
}

function flattenAllModules() {
  const list = [];
  for (const course of Object.keys(CURRICULUM)) {
    for (const yearLevel of Object.keys(CURRICULUM[course])) {
      for (const mod of CURRICULUM[course][yearLevel]) {
        list.push({ ...mod, course, yearLevel });
      }
    }
  }
  return list;
}

function isValidModuleCode(moduleCode) {
  const code = String(moduleCode || '').trim().toUpperCase();
  return flattenAllModules().some(m => m.code.toUpperCase() === code);
}

function moduleMatchesCode(course, yearLevel, moduleName, moduleCode) {
  const hit = findCurriculumModule(course, yearLevel, moduleName, moduleCode);
  return !!hit;
}

//  Maps curriculum module names to regex patterns matched against transcript OCR text.
//  Fallback in getModuleTranscriptPattern builds a pattern from the module name.
const MODULE_TRANSCRIPT_PATTERNS = {};

function getModuleTranscriptPattern(moduleName) {
  if (MODULE_TRANSCRIPT_PATTERNS[moduleName]) {
    return MODULE_TRANSCRIPT_PATTERNS[moduleName];
  }
  const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped.replace(/\s+/g, '\\s+'), 'i');
}


// =============================================================
//  2. RATE TABLE (2026)
//
//  Structure:
//    RATE_TABLE[qualificationLevel][responsibilityLevel] = {
//      hourlyRate,
//      tutorialPay,   // 45-min tutorial → claims 3 hours
//      practicalPay,  // 3-hour practical → claims 5 hours
//    }
//
//  Qualification levels map to the qualification_level ENUM in schema.sql:
//    '3rd_year'          → 3rd year student
//    '4th_year_honours'  → 4th year / Honours student
//    'masters'           → Masters student
//    'masters_holder'    → Masters Holder
//    'phd'               → PhD Candidates or Holder
//
//  Responsibility levels map to the responsibility_level ENUM:
//    'standard' → Low
//    'senior'   → Medium
//    'lead'     → High
//
//  Note: Only Masters Holder and PhD have Medium and High rates.
//  3rd year, 4th year/Honours, and Masters student only have Low.
//  Attempting to assign senior/lead to those levels is a logic error
//  — the API must reject it (see getRateEntry validation below).
// =============================================================

const RATE_TABLE = {

  '3rd_year': {
    standard: { hourlyRate: 59.66, tutorialPay: 178.99, practicalPay: 298.32 },
  },

  '4th_year_honours': {
    standard: { hourlyRate: 73.87, tutorialPay: 221.61, practicalPay: 369.35 },
  },

  'masters': {
    standard: { hourlyRate: 90.92, tutorialPay: 272.76, practicalPay: 454.59 },
  },

  'masters_holder': {
    standard: { hourlyRate: 102.28, tutorialPay: 306.84, practicalPay: 511.40 },
    senior:   { hourlyRate: 110.80, tutorialPay: 332.40, practicalPay: 553.99 },
    lead:     { hourlyRate: 119.33, tutorialPay: 357.98, practicalPay: 596.64 },
  },

  'phd': {
    standard: { hourlyRate: 110.80, tutorialPay: 332.40, practicalPay: 553.99 },
    senior:   { hourlyRate: 119.33, tutorialPay: 357.98, practicalPay: 596.64 },
    lead:     { hourlyRate: 127.84, tutorialPay: 383.53, practicalPay: 639.24 },
  },

};

/**
 * getRateEntry
 * Returns the rate object for a given qualification + responsibility level.
 * Throws a descriptive error if the combination is not in the table —
 * the API should catch this and return a 400.
 *
 * @param {string} qualificationLevel  - qualification_level ENUM value
 * @param {string} responsibilityLevel - responsibility_level ENUM value
 * @returns {{ hourlyRate, tutorialPay, practicalPay }}
 */
function getRateEntry(qualificationLevel, responsibilityLevel) {
  const qualBucket = RATE_TABLE[qualificationLevel];
  if (!qualBucket) {
    throw new Error(`Unknown qualification level: "${qualificationLevel}"`);
  }
  const entry = qualBucket[responsibilityLevel];
  if (!entry) {
    throw new Error(
      `Responsibility level "${responsibilityLevel}" is not valid for ` +
      `qualification level "${qualificationLevel}". ` +
      `Valid levels: ${Object.keys(qualBucket).join(', ')}.`
    );
  }
  return entry;
}


// =============================================================
//  3. SESSION CLAIMING HOURS
//
//  Regardless of actual session duration, the number of
//  claimable hours is fixed by session type per the 2026 rules.
//
//  Types that claim 3 hours (tutorial rate):
//    tutorial, online, revision, lecture
//  Types that claim 5 hours (practical rate):
//    practical
// =============================================================

const CLAIM_HOURS = {
  tutorial: 3,
  online:   3,
  revision: 3,
  lecture:  3,
  practical: 5,
};

/**
 * getClaimHours
 * Returns the number of claimable hours for a session type.
 * Throws if the session type is unrecognised.
 *
 * @param {string} sessionType - session_type ENUM value
 * @returns {number} 3 or 5
 */
function getClaimHours(sessionType) {
  const hours = CLAIM_HOURS[sessionType];
  if (hours === undefined) {
    throw new Error(`Unknown session type: "${sessionType}"`);
  }
  return hours;
}


// =============================================================
//  4. TUTOR HOURS ESTIMATES (informational — section 4.1)
//
//  Used for display purposes in the tutor dashboard.
//  Not used in any calculation.
// =============================================================

const TUTOR_HOURS_ESTIMATE = {
  perDay:   3,
  perWeek:  15,   // 5 working days × 3
  perMonth: 60,   // 4 weeks × 15
};


// =============================================================
//  5. QUALIFICATION RANKING (job posting eligibility)
// =============================================================

const QUALIFICATION_RANK = {
  '3rd_year':         1,
  '4th_year_honours': 2,
  'masters':          3,
  'masters_holder':   4,
  'phd':              5,
};

const COURSE_SHORT_MAP = {
  BICT: 'BICT — Bachelor of ICT',
  DICT: 'DICT — Diploma in ICT',
};

function courseToProgramme(course) {
  if (!course) return null;
  if (course.startsWith('BICT')) return 'BICT';
  if (course.startsWith('DICT')) return 'DICT';
  return null;
}

function minYearLevelToQualEnum(minYearLevel) {
  const s = String(minYearLevel || '').toLowerCase();
  if (/phd/.test(s)) return 'phd';
  if (/masters holder/.test(s)) return 'masters_holder';
  if (/masters/.test(s)) return 'masters';
  if (/4th|honours/.test(s)) return '4th_year_honours';
  return '3rd_year';
}

/**
 * Returns true when the applicant meets or exceeds the posting minimum.
 */
function meetsMinimumQualification(applicantLevel, requiredLevel) {
  const applicant = QUALIFICATION_RANK[applicantLevel] || 0;
  const required  = QUALIFICATION_RANK[requiredLevel]  || 0;
  return applicant >= required && required > 0;
}


// =============================================================
//  EXPORTS
// =============================================================

module.exports = {
  CURRICULUM,
  VALID_COURSES,
  ELECTIVE_MODULES,
  MODULE_TRANSCRIPT_PATTERNS,
  getYearLevels,
  getModuleObjects,
  getModules,
  isValidModule,
  findCurriculumModule,
  resolveCourseKey,
  resolveYearSemesterKey,
  getModuleCode,
  flattenAllModules,
  isValidModuleCode,
  moduleMatchesCode,
  getModuleTranscriptPattern,

  RATE_TABLE,
  getRateEntry,

  CLAIM_HOURS,
  getClaimHours,

  TUTOR_HOURS_ESTIMATE,

  QUALIFICATION_RANK,
  COURSE_SHORT_MAP,
  courseToProgramme,
  minYearLevelToQualEnum,
  meetsMinimumQualification,
};