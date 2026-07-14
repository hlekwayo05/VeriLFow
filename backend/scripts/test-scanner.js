'use strict';

const { screenApplication, parseAcademicRecord } = require('../services/documentScanner');
const { extractPdfText } = require('../services/pdfText');

(async () => {
  const transcriptPath = process.argv[2] || 'c:/Users/khoza/Downloads/Academic record.pdf';

  const { text, method } = await extractPdfText(transcriptPath);
  console.log('Extract method:', method);
  console.log('Text length:', text.length);

  const modules = parseAcademicRecord(text);
  console.log('Modules parsed:', modules.length);
  modules.forEach(m => console.log(`  ${m.code} ${m.finalMark}% ${m.result}`));

  const result = await screenApplication({
    cvPath: transcriptPath,
    transcriptPath,
    claimedAverage: 75,
    tutorModuleName: 'Programming',
    settings: {
      cv_keywords: 'programming, database, networking',
      min_average: '75',
      module_pass_mark: '70',
      min_cv_keywords: '0',
    },
  });

  console.log('\nScreening result:');
  console.log('  pass:', result.pass);
  console.log('  reason:', result.reason);
  console.log('  detail:', result.detail);
  console.log('  average:', result.screening?.transcript?.calculatedAverage);
  console.log('  tutor module:', result.screening?.transcript?.tutorModule?.name);
})().catch(err => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
