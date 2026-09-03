'use strict';

const PDFDocument = require('pdfkit');

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function monthYearLabel(month, year) {
  return `${MONTHS[month - 1] || month} ${year}`;
}

function formatReviewDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatSessionDate(dateStr) {
  if (!dateStr) return '-';
  return new Date(String(dateStr).slice(0, 10)).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
  });
}

function formatTimeRange(startTime, sessionType) {
  if (!startTime) return '-';
  const start = String(startTime).slice(0, 5);
  const [h, m] = start.split(':').map(Number);
  const mins = sessionType === 'practical' ? 180 : 45;
  const endDate = new Date(2000, 0, 1, h, m + mins);
  const end = `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`;
  return `${start}-${end}`;
}

function lecturerStep(status) {
  if (!status) return { approved: false, label: 'Not submitted', subtitle: 'Claim not yet submitted' };
  if (status === 'pending_lecturer') return { approved: false, label: 'Pending review', subtitle: 'Awaiting lecturer' };
  if (status === 'returned_by_lecturer') return { approved: false, label: 'Returned', subtitle: 'Sent back to tutor' };
  if (['pending_coordinator', 'approved', 'returned_by_coordinator'].includes(status)) {
    return { approved: true, label: 'Approved', subtitle: 'Forwarded to coordinator' };
  }
  return { approved: false, label: '-', subtitle: '' };
}

function coordinatorStep(status) {
  if (!status || status === 'pending_lecturer') {
    return { approved: false, label: 'Not yet', subtitle: 'After lecturer review' };
  }
  if (status === 'returned_by_lecturer') {
    return { approved: false, label: 'Not yet', subtitle: 'Claim returned to tutor' };
  }
  if (status === 'pending_coordinator') {
    return { approved: false, label: 'Pending approval', subtitle: 'FYE Office' };
  }
  if (status === 'returned_by_coordinator') {
    return { approved: false, label: 'Returned', subtitle: 'FYE Office' };
  }
  if (status === 'approved') {
    return { approved: true, label: 'Approved', subtitle: 'FYE Office · Finance handoff' };
  }
  return { approved: false, label: '-', subtitle: '' };
}

function money(amount) {
  if (amount == null) return '-';
  return `R${Number(amount).toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function drawApprovalBox(doc, x, y, width, title, step, name, reviewedAt) {
  const h = 72;
  doc.roundedRect(x, y, width, h, 6).lineWidth(1);
  if (step.approved) {
    doc.fillColor('#eef8f1').strokeColor('#5cc88a').fillAndStroke();
  } else {
    doc.fillColor('#fafafa').strokeColor('#dddddd').fillAndStroke();
  }

  doc.fillColor('#666666').fontSize(7).font('Helvetica-Bold')
    .text(title.toUpperCase(), x + 10, y + 10, { width: width - 20 });

  doc.fillColor(step.approved ? '#1a7a52' : '#333333').fontSize(11).font('Helvetica-Bold')
    .text(step.label, x + 10, y + 22, { width: width - 20 });

  doc.fillColor('#444444').fontSize(9).font('Helvetica')
    .text(name || step.subtitle, x + 10, y + 38, { width: width - 20 });

  if (reviewedAt) {
    doc.fillColor('#777777').fontSize(8).font('Helvetica')
      .text(reviewedAt, x + 10, y + 52, { width: width - 20 });
  } else if (step.subtitle && name) {
    doc.fillColor('#777777').fontSize(8).font('Helvetica')
      .text(step.subtitle, x + 10, y + 52, { width: width - 20 });
  }

  doc.fillColor('#000000');
}

function drawSessionTable(doc, sessions, startY) {
  const left = 50;
  const cols = [
    { label: 'Date', w: 52 },
    { label: 'Time', w: 58 },
    { label: 'Venue', w: 68 },
    { label: 'Topic', w: 130 },
    { label: 'Type', w: 58 },
    { label: 'Att.', w: 42 },
    { label: 'Hrs', w: 36 },
  ];

  let y = startY;
  let x = left;
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#666666');
  cols.forEach((col) => {
    doc.text(col.label, x + 2, y, { width: col.w - 4 });
    x += col.w;
  });
  y += 14;
  doc.moveTo(left, y).lineTo(left + cols.reduce((s, c) => s + c.w, 0), y).strokeColor('#dddddd').stroke();
  y += 6;

  doc.font('Helvetica').fontSize(8).fillColor('#222222');
  sessions.forEach((row, idx) => {
    if (y > 720) {
      doc.addPage();
      y = 50;
    }
    x = left;
    const present = row.attendance_count ?? 0;
    const enrolled = row.enrolled_count ?? 0;
    const values = [
      formatSessionDate(row.session_date),
      formatTimeRange(row.start_time, row.session_type),
      (row.venue || '-').slice(0, 18),
      (row.topic || '-').slice(0, 32),
      (row.session_type || '-').slice(0, 10),
      `${present}/${enrolled || '-'}`,
      String(row.claimed_hours ?? '-'),
    ];
    values.forEach((val, i) => {
      doc.text(val, x + 2, y, { width: cols[i].w - 4, lineBreak: false });
      x += cols[i].w;
    });
    y += 14;
    if (idx < sessions.length - 1) {
      doc.moveTo(left, y - 4).lineTo(left + cols.reduce((s, c) => s + c.w, 0), y - 4).strokeColor('#eeeeee').stroke();
    }
  });

  return y + 8;
}

/**
 * @param {object} data
 * @returns {Promise<Buffer>}
 */
function buildTimesheetPdf(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const contentWidth = doc.page.width - 100;
    const period = monthYearLabel(data.periodMonth, data.periodYear);
    const lec = lecturerStep(data.claim?.status);
    const coord = coordinatorStep(data.claim?.status);
    const lecturerName = data.lecturerName || 'Assigned lecturer';
    const lecDate = lec.approved ? formatReviewDate(data.claim?.lecturer_reviewed_at) : null;
    const coordDate = coord.approved ? formatReviewDate(data.claim?.coordinator_reviewed_at) : null;

    doc.font('Helvetica-Bold').fontSize(20).fillColor('#111111')
      .text('VeriFlow Timesheet', 50, doc.y, { width: contentWidth, align: 'center' });
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(11).fillColor('#666666')
      .text(`${period} · ${data.moduleCode || '-'}`, 50, doc.y, { width: contentWidth, align: 'center' });
    doc.moveDown(0.4);
    doc.font('Helvetica').fontSize(9).fillColor('#222222')
      .text(`${data.tutorName || '-'}  ·  ${data.studentNumber || '-'}`, 50, doc.y, { width: contentWidth, align: 'center' });

    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#333333')
      .text('Approval status', 50, doc.y, { width: contentWidth, align: 'center' });
    doc.moveDown(0.3);

    const boxY = doc.y;
    const gap = 12;
    const boxW = (contentWidth - gap) / 2;
    drawApprovalBox(doc, 50, boxY, boxW, 'Lecturer review', lec, lecturerName, lecDate);
    drawApprovalBox(doc, 50 + boxW + gap, boxY, boxW, 'Coordinator approval', coord, 'FYE Office', coordDate);
    doc.y = boxY + 82;

    doc.font('Helvetica-Bold').fontSize(10).fillColor('#333333')
      .text('Sessions', 50, doc.y, { width: contentWidth, align: 'center' });
    doc.moveDown(0.2);

    const tableEndY = drawSessionTable(doc, data.sessions || [], doc.y);

    doc.y = tableEndY + 6;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111111')
      .text(
        `Total: ${data.totalHours ?? 0} hrs  ·  ${money(data.totalAmount)}  ·  Rate: ${data.payRate != null ? `R${Number(data.payRate).toFixed(2)}/hr` : '-'}`,
        50,
        doc.y,
        { width: contentWidth, align: 'center' }
      );

    if (data.claim?.status === 'approved') {
      doc.moveDown(0.6);
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#1a7a52')
        .text(
          'This timesheet has been verified by the assigned lecturer and approved by the coordinator.',
          50,
          doc.y,
          { width: contentWidth, align: 'center' }
        );
    }

    doc.moveDown(1.2);
    doc.font('Helvetica').fontSize(8).fillColor('#aaaaaa')
      .text(`Generated by VeriFlow · ${new Date().toLocaleString('en-ZA')} · Read-only record`, { align: 'center' });

    doc.end();
  });
}

module.exports = {
  buildTimesheetPdf,
  monthYearLabel,
};
