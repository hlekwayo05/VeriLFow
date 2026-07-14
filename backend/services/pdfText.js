'use strict';

const fs = require('fs');
const pdfParse = require('pdf-parse');

/**
 * Extract readable text from a PDF file.
 * Tries embedded text first; falls back to OCR for image-based PDFs
 * (e.g. UMP academic records printed via "Microsoft Print To PDF").
 */
async function extractPdfText(filePath) {
  const buffer = fs.readFileSync(filePath);

  try {
    const result = await pdfParse(buffer);
    const text = (result.text || '').trim();

    if (text.length >= 80) {
      return { text: result.text, method: 'embedded' };
    }

    // Text too short — PDF may be image-based
    // Fall back to OCR on the file directly
    console.warn(
      'PDF text extraction yielded short result ' +
      '(' + text.length + ' chars) — trying OCR fallback'
    );
    const ocrText = await ocrPdfFile(filePath);
    return { text: ocrText, method: 'ocr' };

  } catch (err) {
    console.error('PDF parse error:', err.message);
    // Last resort: try OCR directly
    try {
      const ocrText = await ocrPdfFile(filePath);
      return { text: ocrText, method: 'ocr-fallback' };
    } catch (ocrErr) {
      console.error('OCR fallback error:', ocrErr.message);
      return { text: '', method: 'failed' };
    }
  }
}

async function ocrPdfFile(filePath) {
  const { createWorker } = require('tesseract.js');
  const worker = await createWorker('eng');
  try {
    const { data: { text } } = await worker.recognize(filePath);
    return text || '';
  } finally {
    await worker.terminate();
  }
}

module.exports = { extractPdfText };
