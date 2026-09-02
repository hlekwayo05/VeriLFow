'use strict';

const { extractPdfText } = require('./pdfText');
const { getModuleTranscriptPattern, flattenAllModules } = require('../constants');

const PASS_MARK_DEFAULT = 50;
const AVERAGE_TOLERANCE   = 1.5;

/**
 * Scan a CV PDF against admin-configured keywords.
 * Returns a score (matched count) and detail for admin review.
 */
async function scanCv(cvPath, keywords) {
  const { text } = await extractPdfText(cvPath);
  const haystack = text.toLowerCase();
  const list     = (keywords || [])
    .map(k => k.trim())
    .filter(Boolean);

  const matched = [];
  const missing = [];

  for (const keyword of list) {
    if (haystack.includes(keyword.toLowerCase())) {
      matched.push(keyword);
    } else {
      missing.push(keyword);
    }
  }

  return {
    score:          matched.length,
    totalKeywords:  list.length,
    matched,
    missing,
    textLength:     text.length,
  };
}

/**
 * Parse UMP-style academic record text (embedded or OCR).
 *
 * ITS iEnabler layout (typical):
 *   Year: 2025
 *   Subject: DICT211
 *   Academic Period: SEMESTER ONE
 *   Year Mark: 82
 *   Result: PASS
 *   APPLICATION DEVELOPMENT 211
 *   Final Mark: 72
 */
function parseAcademicRecord(text) {
  const normalized = text.replace(/\r/g, '');
  const modules    = [];

  const blocks = normalized.split(/(?=Year:\s*\d{4})/i).filter(b => /Subject:/i.test(b));

  for (const block of blocks) {
    const module = parseModuleBlock(block);
    if (module) modules.push(module);
  }

  if (modules.length === 0) {
    const altBlocks = normalized.split(/(?=Subject:\s*[A-Za-z0-9])/i);
    for (const block of altBlocks) {
      if (!/Subject:/i.test(block)) continue;
      const module = parseModuleBlock(block);
      if (module) modules.push(module);
    }
  }

  return dedupeModules(modules);
}

function dedupeModules(modules) {
  const seen = new Map();
  for (const m of modules) {
    const key = `${m.code}|${m.year || ''}|${m.finalMark}`;
    if (!seen.has(key)) seen.set(key, m);
  }
  return [...seen.values()];
}

function parseModuleBlock(block) {
  const codeMatch   = block.match(/Subject:\s*([A-Za-z0-9]+)/i);
  const yearMatch   = block.match(/Year:\s*(\d{4})/i);
  const finalMatch  = block.match(/Final Mark:\s*(\d+)/i);
  const resultMatch = block.match(/Result:\s*([^\n]+)/i);

  if (!codeMatch || !finalMatch || !resultMatch) return null;

  const result = resultMatch[1].trim();
  const code   = normalizeSubjectCode(codeMatch[1]);

  // Preferred: title line after Result and before Final Mark
  // e.g. "APPLICATION DEVELOPMENT 211"
  let name = '';
  const titled = block.match(
    /Result:\s*[^\n]+\n+\s*([A-Za-z][A-Za-z0-9][^\n]*?)\s*(?:\n+\s*)?Final Mark:/i
  );
  if (titled) {
    name = titled[1].trim();
  }

  // Fallback: "Subject: CODE Module Name …" on one line (older exports)
  if (!name || /^Academic Period\b/i.test(name)) {
    const inline = block.match(
      /Subject:\s*[A-Za-z0-9]+\s+(.+?)(?:\n|Academic Period)/i
    );
    if (inline) {
      const candidate = inline[1].trim();
      if (candidate && !/^Academic Period\b/i.test(candidate)) {
        name = candidate;
      }
    }
  }

  if (!name || /^Academic Period\b/i.test(name)) {
    name = code;
  }

  return {
    code,
    name:      name.toUpperCase(),
    year:      yearMatch ? parseInt(yearMatch[1], 10) : null,
    finalMark: parseInt(finalMatch[1], 10),
    result,
    passed:    isPassResult(result),
  };
}

function normalizeSubjectCode(raw) {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function isPassResult(resultText) {
  const r = resultText.toUpperCase();
  if (/\bFAIL(?:ED|URE)?\b/.test(r)) return false;
  if (/\bPASS\b/.test(r) || /\bDISTINCTION\b/.test(r) || /\bPROMOTED\b/.test(r)) return true;
  return false;
}

function calculateAverage(modules) {
  if (!modules.length) return null;
  const sum = modules.reduce((acc, m) => acc + m.finalMark, 0);
  return Math.round((sum / modules.length) * 100) / 100;
}

function curriculumCodesForModuleName(moduleName) {
  if (!moduleName) return [];
  const needle = String(moduleName).trim().toLowerCase();
  return flattenAllModules()
    .filter((m) => String(m.name).trim().toLowerCase() === needle)
    .map((m) => String(m.code).toUpperCase());
}

function findTutorModule(modules, moduleName) {
  const pattern = getModuleTranscriptPattern(moduleName);
  let matches = modules.filter((m) => pattern.test(m.name));

  // Also match by curriculum subject code (e.g. DICT211 ↔ Application Development 211)
  if (!matches.length) {
    const codes = new Set(curriculumCodesForModuleName(moduleName));
    if (codes.size) {
      matches = modules.filter((m) => codes.has(String(m.code).toUpperCase()));
    }
  }

  // Last resort: module name contains key tokens from the applied module
  if (!matches.length && moduleName) {
    const tokens = String(moduleName)
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2);
    if (tokens.length) {
      matches = modules.filter((m) => {
        const hay = `${m.code} ${m.name}`.toUpperCase();
        return tokens.every((t) => hay.includes(t));
      });
    }
  }

  if (!matches.length) return null;

  const passed = matches.filter((m) => m.passed);
  if (!passed.length) return matches.sort((a, b) => b.finalMark - a.finalMark)[0];

  return passed.sort((a, b) => b.finalMark - a.finalMark)[0];
}

/**
 * Validate an academic record against application claims.
 */
async function scanAcademicRecord(transcriptPath, {
  claimedAverage,
  tutorModuleName,
  minAverage       = 75,
  modulePassMark   = 70,
  passMark         = PASS_MARK_DEFAULT,
}) {
  const { text, method } = await extractPdfText(transcriptPath);
  const modules          = parseAcademicRecord(text);
  const calculatedAverage = calculateAverage(modules);

  const failedModules = modules.filter(m => !m.passed);
  const tutorModule   = tutorModuleName ? findTutorModule(modules, tutorModuleName) : null;

  const result = {
    parseMethod:        method,
    modulesParsed:      modules.length,
    modules,
    calculatedAverage,
    claimedAverage:     claimedAverage != null ? parseFloat(claimedAverage) : null,
    averageMatch:       null,
    allModulesPassed:   failedModules.length === 0 && modules.length > 0,
    failedModules:      failedModules.map(m => `${m.code} ${m.name} (${m.result})`),
    tutorModuleFound:   !!tutorModule,
    tutorModule:        tutorModule
      ? {
          code:      tutorModule.code,
          name:      tutorModule.name,
          finalMark: tutorModule.finalMark,
          result:    tutorModule.passed ? 'Pass' : 'Fail',
          passed:    tutorModule.passed,
        }
      : null,
    tutorModulePassed:  tutorModule ? tutorModule.passed && tutorModule.finalMark >= modulePassMark : false,
    minAverage,
    modulePassMark,
  };

  if (result.claimedAverage != null && calculatedAverage != null) {
    result.averageMatch = Math.abs(calculatedAverage - result.claimedAverage) <= AVERAGE_TOLERANCE;
  }

  return result;
}

/**
 * Run full eligibility validation from scan results.
 * Returns { pass, reason, detail, screening }.
 */
function evaluateScreening(cvScan, transcriptScan, settings, positionType = 'tutor') {
  const screening = { cv: cvScan, transcript: transcriptScan };
  const isDemo         = positionType === 'demonstrator';
  const minAverage     = parseFloat(settings.min_average) || 75;
  const modulePassMark = parseFloat(settings.module_pass_mark) || 70;
  const minCvKeywords  = parseInt(settings.min_cv_keywords, 10) || 0;

  if (transcriptScan.modulesParsed === 0) {
    return {
      pass: false,
      reason: 'We could not read your academic record.',
      detail: 'Please upload a clear PDF export from ITS iEnabler. Scanned or blurry documents may not be processed.',
      screening,
    };
  }

  if (!isDemo && !transcriptScan.allModulesPassed) {
    const failed = transcriptScan.failedModules.slice(0, 3).join('; ');
    return {
      pass: false,
      reason: 'Your academic record shows modules that were not passed.',
      detail: `Failed module(s): ${failed}${transcriptScan.failedModules.length > 3 ? '…' : ''}. All modules must be passed to tutor.`,
      screening,
    };
  }

  if (!isDemo && !transcriptScan.tutorModuleFound) {
    return {
      pass: false,
      reason: `No passed record found for "${transcriptScan.tutorModuleName || 'your selected module'}" on your academic record.`,
      detail: 'The module you applied to tutor must appear on your transcript with a pass result.',
      screening,
    };
  }

  if (!isDemo && !transcriptScan.tutorModulePassed) {
    const tm = transcriptScan.tutorModule;
    return {
      pass: false,
      reason: `You have not achieved the required mark in ${tm.name}.`,
      detail: `Your final mark is ${tm.finalMark}% (minimum ${modulePassMark}% required to tutor this module). Result: ${tm.result}.`,
      screening,
    };
  }

  if (transcriptScan.averageMatch === false) {
    return {
      pass: false,
      reason: 'The average on your academic record does not match what you declared.',
      detail: `You declared ${transcriptScan.claimedAverage}%, but your academic record average is ${transcriptScan.calculatedAverage}%.`,
      screening,
    };
  }

  if (transcriptScan.calculatedAverage != null && transcriptScan.calculatedAverage < minAverage) {
    return {
      pass: false,
      reason: `Your academic average of ${transcriptScan.calculatedAverage}% does not meet the minimum requirement of ${minAverage}%.`,
      detail: 'This average was calculated from the final marks on your uploaded academic record.',
      screening,
    };
  }

  if (minCvKeywords > 0 && cvScan.score < minCvKeywords) {
    return {
      pass: false,
      reason: 'Your CV does not contain enough relevant keywords.',
      detail: `Matched ${cvScan.score} of ${cvScan.totalKeywords} required keywords (${minCvKeywords} minimum).`,
      screening,
    };
  }

  return { pass: true, reason: null, detail: null, screening };
}

/**
 * Full document screening for application submit.
 */
async function screenApplication({ cvPath, transcriptPath, claimedAverage, tutorModuleName, settings, positionType = 'tutor' }) {
  const keywords = (settings.cv_keywords || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);

  const cvScan = await scanCv(cvPath, keywords);

  const transcriptScan = await scanAcademicRecord(transcriptPath, {
    claimedAverage,
    tutorModuleName,
    minAverage:     parseFloat(settings.min_average) || 75,
    modulePassMark: parseFloat(settings.module_pass_mark) || 70,
  });
  transcriptScan.tutorModuleName = tutorModuleName;

  return evaluateScreening(cvScan, transcriptScan, settings, positionType);
}

module.exports = {
  scanCv,
  scanAcademicRecord,
  parseAcademicRecord,
  evaluateScreening,
  screenApplication,
};
