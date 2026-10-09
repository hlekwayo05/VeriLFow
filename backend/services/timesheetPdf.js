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

function sessionDest(row) {
  return row.id ? `register-${row.id}` : null;
}

function formatSignIn(recordedAt) {
  if (!recordedAt) return '-';
  return new Date(recordedAt).toLocaleTimeString('en-ZA', { hour: 'numeric', minute: '2-digit' });
}

function drawSessionTable(doc, sessions, startY) {
  const left = 50;
  const cols = [
    { label: 'Date', w: 58 },
    { label: 'Time', w: 72 },
    { label: 'Venue', w: 118 },
    { label: 'Topic', w: 112 },
    { label: 'Type', w: 52 },
    { label: 'Att.', w: 48 },
    { label: 'Hrs', w: 35 },
  ];
  const tableWidth = cols.reduce((sum, col) => sum + col.w, 0);

  let y = startY;
  let x = left;
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#666666');
  cols.forEach((col) => {
    doc.text(col.label, x + 2, y, { width: col.w - 4 });
    x += col.w;
  });
  y += 14;
  doc.moveTo(left, y).lineTo(left + tableWidth, y).strokeColor('#dddddd').stroke();
  y += 6;

  sessions.forEach((row, idx) => {
    const present = row.attendance_count ?? 0;
    const enrolled = row.enrolled_count ?? 0;
    const type = row.session_type
      ? row.session_type.charAt(0).toUpperCase() + row.session_type.slice(1)
      : '-';
    const values = [
      formatSessionDate(row.session_date),
      formatTimeRange(row.start_time, row.session_type),
      row.venue || '-',
      row.topic || '-',
      type,
      `${present}/${enrolled || '-'}`,
      String(row.claimed_hours ?? '-'),
    ];
    const dest = sessionDest(row);

    doc.font('Helvetica').fontSize(8);
    const rowHeight = Math.max(
      12,
      ...values.map((val, i) => doc.heightOfString(String(val), { width: cols[i].w - 4 }))
    );
    if (y + rowHeight > 720) {
      doc.addPage();
      y = 50;
    }

    x = left;
    values.forEach((val, i) => {
      const isLink = i === 5 && dest;
      doc.fillColor(isLink ? '#2B5259' : '#222222').font(isLink ? 'Helvetica-Bold' : 'Helvetica');
      doc.text(String(val), x + 2, y, {
        width: cols[i].w - 4,
        underline: Boolean(isLink),
        goTo: isLink ? dest : undefined,
      });
      x += cols[i].w;
    });
    y += rowHeight + 8;
    if (idx < sessions.length - 1) {
      doc.moveTo(left, y - 4).lineTo(left + tableWidth, y - 4).strokeColor('#eeeeee').stroke();
    }
  });

  doc.fillColor('#000000');
  return y + 4;
}

function drawRegister(doc, session) {
  const dest = sessionDest(session);
  if (!dest) return;

  doc.addPage();
  doc.addNamedDestination(dest);

  const left = 50;
  const contentWidth = doc.page.width - 100;
  const present = session.attendance_count ?? 0;
  const enrolled = session.enrolled_count ?? (session.students || []).length;
  const date = formatSessionDate(session.session_date);
  const time = formatTimeRange(session.start_time, session.session_type);

  doc.font('Helvetica').fontSize(8).fillColor('#888888')
    .text('ATTENDANCE REGISTER', left, 50, { width: contentWidth });
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#111111')
    .text(`${date} · ${session.topic || 'Session'}`, left, doc.y, { width: contentWidth });
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(9).fillColor('#555555')
    .text(`${time} · ${session.venue || '-'}`, left, doc.y, { width: contentWidth });
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#222222')
    .text(`${present} of ${enrolled || '-'} present`, left, doc.y, { width: contentWidth });
  doc.moveDown(0.8);

  const students = session.students || [];
  if (!students.length) {
    doc.font('Helvetica').fontSize(10).fillColor('#666666')
      .text('No students on the class list for this session.', left, doc.y, { width: contentWidth });
    return;
  }

  const cols = [
    { label: '#', w: 28 },
    { label: 'Student number', w: 110 },
    { label: 'Name', w: 210 },
    { label: 'Signed in', w: 70 },
    { label: 'Status', w: 77 },
  ];
  let y = doc.y;
  let x = left;
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#666666');
  cols.forEach((col) => {
    doc.text(col.label, x, y, { width: col.w });
    x += col.w;
  });
  y += 14;
  doc.moveTo(left, y).lineTo(left + cols.reduce((sum, col) => sum + col.w, 0), y).strokeColor('#dddddd').stroke();
  y += 6;

  students.forEach((student, index) => {
    if (y > 760) {
      doc.addPage();
      y = 50;
    }
    const values = [
      String(index + 1).padStart(2, '0'),
      student.student_number || '-',
      student.full_name || '-',
      student.present ? formatSignIn(student.recorded_at) : '-',
      student.present ? 'Present' : 'Absent',
    ];
    x = left;
    values.forEach((val, i) => {
      const absent = !student.present && i >= 3;
      doc.font('Helvetica').fontSize(8).fillColor(absent ? '#999999' : '#222222')
        .text(String(val), x, y, { width: cols[i].w - 6 });
      x += cols[i].w;
    });
    y += 16;
  });
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
    doc.moveDown(0.15);
    doc.font('Helvetica').fontSize(8).fillColor('#888888')
      .text('Select an attendance figure to open that session’s register.', 50, doc.y, { width: contentWidth, align: 'center' });
    doc.moveDown(0.35);

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

    (data.sessions || []).forEach((session) => drawRegister(doc, session));

    doc.end();
  });
}

module.exports = {
  buildTimesheetPdf,
  monthYearLabel,
};
