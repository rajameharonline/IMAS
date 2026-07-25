import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

/* hex → [r, g, b] */
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  if (h.length < 6) return [220, 80, 20];
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}

async function downloadInvoice(billId, apiInstance) {
  const resp = await apiInstance.get(`/billing/bills/${billId}/`);
  const bill = resp.data;

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 14;

  const fmtN = (v) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  const monthShort = (m) => { const [y,mo]=m.split('-'); return `${MONTHS[+mo-1].slice(0,3)}-${y.slice(2)}`; };
  const today = new Date();
  const todayStr = `${String(today.getDate()).padStart(2,'0')} ${MONTHS[today.getMonth()].slice(0,3)} ${today.getFullYear()}`;

  const co = {
    name:    bill.company_name    || 'ISP Company',
    address: bill.company_address || '',
    phone:   bill.company_phone   || '',
    email:   bill.company_email   || '',
  };
  const hRgb       = hexToRgb(bill.invoice_header_color || '#DC5014');
  const noteText   = bill.invoice_note   || "This is a computerized Invoice and doesn't need any signature.";
  const footerText = bill.invoice_footer || '';
  const showLogo   = bill.invoice_show_logo !== false;

  /* status config */
  const sCfg = {
    paid:    { label: 'PAID',    rgb: [22, 163, 74],   bgRgb: [220, 252, 231] },
    partial: { label: 'PARTIAL', rgb: [217, 119, 6],   bgRgb: [254, 243, 199] },
    unpaid:  { label: 'UNPAID',  rgb: [220, 38, 38],   bgRgb: [254, 226, 226] },
    waived:  { label: 'WAIVED',  rgb: [100, 116, 139], bgRgb: [241, 245, 249] },
  }[bill.status] || { label: 'UNPAID', rgb: [220, 38, 38], bgRgb: [254, 226, 226] };
  const isPaid = bill.status === 'paid' || bill.status === 'waived';

  const previousDue = Math.max(Number(bill.client_total_due || 0) - Number(bill.due_amount || 0), 0);
  const balanceDue  = Number(bill.client_total_due || bill.due_amount || 0);
  const invNo = `INV-${String(bill.id).padStart(5,'0')}-${bill.client_customer_id || ''}`;

  /* ── LOGO (top-left) ────────────────────────────────── */
  let logoLoaded = false;
  if (showLogo && bill.company_logo_b64) {
    try {
      const imgType = bill.company_logo_b64.includes('image/png') ? 'PNG' : 'JPEG';
      doc.addImage(bill.company_logo_b64, imgType, M, 5, 38, 22);
      logoLoaded = true;
    } catch {}
  }
  if (!logoLoaded) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.setTextColor(...hRgb);
    doc.text(co.name, M, 18);
  }

  /* ── STATUS BADGE (top-right) ───────────────────────── */
  const badgeW = 36, badgeH = 11, badgeX = W - M - badgeW;
  doc.setFillColor(...sCfg.rgb);
  doc.roundedRect(badgeX, 5, badgeW, badgeH, 2.5, 2.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(255, 255, 255);
  doc.text(sCfg.label, badgeX + badgeW / 2, 12.5, { align: 'center' });

  /* ── "INVOICE" title (center) ───────────────────────── */
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...hRgb);
  doc.text('INVOICE', W / 2, 14, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(110, 110, 110);
  doc.text(monthShort(bill.bill_month), W / 2, 21, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(90, 90, 90);
  doc.text(invNo, W - M, 21, { align: 'right' });

  /* ── COMPANY INFO STRIP ─────────────────────────────── */
  doc.setFillColor(...hRgb);
  doc.rect(M, 29, W - M * 2, 9, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(255, 255, 255);
  const contactParts = [
    co.address,
    co.phone ? `Tel: ${co.phone}` : '',
    co.email ? `Email: ${co.email}` : '',
  ].filter(Boolean);
  if (contactParts.length) {
    doc.text(contactParts.join('   |   '), W / 2, 35, { align: 'center' });
  }

  /* ── TWO COLUMN BOXES ───────────────────────────────── */
  const boxY = 43, boxH = 56;
  const col1W = 93, col2X = M + col1W + 4, col2W = W - M * 2 - col1W - 4;

  /* Left box: BILL TO */
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(M, boxY, col1W, boxH, 2, 2, 'F');
  doc.setDrawColor(215, 220, 230);
  doc.setLineWidth(0.25);
  doc.roundedRect(M, boxY, col1W, boxH, 2, 2, 'S');
  doc.setFillColor(...hRgb);
  doc.roundedRect(M, boxY, col1W, 8, 2, 2, 'F');
  doc.rect(M, boxY + 4, col1W, 4, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text('BILL TO', M + 4, boxY + 5.8);

  let cl = boxY + 15;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  const nameLines = doc.splitTextToSize(bill.client_name || '—', col1W - 8);
  doc.text(nameLines, M + 4, cl);
  cl += nameLines.length * 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(55, 65, 90);
  [
    bill.client_username ? `ID: ${bill.client_username}${bill.client_ip ? '  |  IP: '+bill.client_ip : ''}` : null,
    bill.client_phone    ? `Phone: ${bill.client_phone}` : null,
    bill.client_zone     ? `Zone: ${bill.client_zone}` : null,
    bill.client_package  ? `Package: ${bill.client_package}` : null,
    bill.client_connection_type ? `Connection: ${bill.client_connection_type}` : null,
    bill.client_address  ? `Address: ${bill.client_address}` : null,
  ].filter(Boolean).forEach(line => {
    if (cl > boxY + boxH - 3) return;
    const wl = doc.splitTextToSize(line, col1W - 8);
    doc.text(wl, M + 4, cl);
    cl += wl.length * 5.2;
  });

  /* Right box: INVOICE DETAILS */
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(col2X, boxY, col2W, boxH, 2, 2, 'F');
  doc.setDrawColor(215, 220, 230);
  doc.roundedRect(col2X, boxY, col2W, boxH, 2, 2, 'S');
  doc.setFillColor(...hRgb);
  doc.roundedRect(col2X, boxY, col2W, 8, 2, 2, 'F');
  doc.rect(col2X, boxY + 4, col2W, 4, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text('INVOICE DETAILS', col2X + 4, boxY + 5.8);

  let dr = boxY + 16;
  [
    ['Customer ID',   String(bill.client_customer_id || '—')],
    ['Invoice Month', monthShort(bill.bill_month)],
    ['Generated',     todayStr],
    ['Expire Date',   String(bill.client_expiry || '—')],
    ['Bill Date',     bill.client_bill_date ? `${bill.client_bill_date}th of month` : '—'],
    ['Adv. Balance',  fmtN(bill.client_advance_balance)],
    ['Status',        sCfg.label],
  ].forEach(([label, value]) => {
    const isStatus = label === 'Status';
    doc.setFont('helvetica', isStatus ? 'bold' : 'normal');
    doc.setFontSize(8);
    doc.setTextColor(isStatus ? sCfg.rgb[0] : 70, isStatus ? sCfg.rgb[1] : 80, isStatus ? sCfg.rgb[2] : 100);
    doc.text(label, col2X + 4, dr);
    doc.setTextColor(isStatus ? sCfg.rgb[0] : 20, isStatus ? sCfg.rgb[1] : 20, isStatus ? sCfg.rgb[2] : 20);
    doc.text(String(value), col2X + col2W - 4, dr, { align: 'right' });
    dr += 5.3;
  });

  /* ── ITEMS TABLE ─────────────────────────────────────── */
  const tableY = boxY + boxH + 5;
  const itemBody = [
    ['1', `Monthly Internet Bill — ${bill.client_package || 'Internet Service'}${bill.client_connection_type ? ' ('+bill.client_connection_type+')' : ''}`, fmtN(bill.amount || bill.net_amount)],
  ];
  if (Number(bill.discount || 0) > 0) {
    itemBody.push(['—', 'Discount Applied', `-${fmtN(bill.discount)}`]);
  }

  autoTable(doc, {
    startY: tableY,
    head:   [['#', 'Description', 'Amount (৳)']],
    body:   itemBody,
    theme:  'grid',
    headStyles: { fillColor: hRgb, textColor: [255,255,255], fontStyle: 'bold', fontSize: 9, cellPadding: 3.5 },
    bodyStyles: { fontSize: 9, cellPadding: 3.5, textColor: [20, 20, 20] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 12, halign: 'center' },
      1: { cellWidth: 142 },
      2: { cellWidth: 28, halign: 'right' },
    },
    margin: { left: M, right: M },
  });

  let currentY = doc.lastAutoTable.finalY;

  /* ── PAYMENT HISTORY TABLE ───────────────────────────── */
  const payments = bill.payments_summary || [];
  if (payments.length > 0) {
    currentY += 5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...hRgb);
    doc.text('Payment History', M, currentY);

    autoTable(doc, {
      startY: currentY + 3,
      head:   [['Date', 'Method', 'Received By', 'Amount (৳)', 'Status']],
      body:   payments.map(p => [
        p.date,
        (p.method || '').charAt(0).toUpperCase() + (p.method || '').slice(1),
        p.received_by || '—',
        fmtN(p.amount),
        '✓ Verified',
      ]),
      theme:  'striped',
      headStyles: { fillColor: [51, 65, 85], textColor: [255,255,255], fontSize: 8, cellPadding: 3 },
      bodyStyles: { fontSize: 8, cellPadding: 3, textColor: [30, 30, 30] },
      columnStyles: {
        0: { cellWidth: 34 },
        1: { cellWidth: 32 },
        2: { cellWidth: 48 },
        3: { cellWidth: 34, halign: 'right' },
        4: { cellWidth: 34, halign: 'center', textColor: [22, 163, 74] },
      },
      margin: { left: M, right: M },
    });
    currentY = doc.lastAutoTable.finalY;
  }

  /* ── SUMMARY BOX (right-aligned) ────────────────────── */
  const sumBoxW = 95, sumBoxX = W - M - sumBoxW;
  let sy = currentY + 4;

  [
    { label: 'Sub-Total',    value: fmtN(bill.amount || bill.net_amount), bold: false, color: [50, 50, 60] },
    ...(Number(bill.discount || 0) > 0 ? [
      { label: 'Discount (-)', value: fmtN(bill.discount), bold: false, color: [22, 163, 74] },
    ] : []),
    { label: 'Net Amount',   value: fmtN(bill.net_amount), bold: false, color: [50, 50, 60] },
    { label: 'Paid Amount',  value: fmtN(bill.paid_amount), bold: false, color: [22, 163, 74] },
    ...(previousDue > 0 ? [
      { label: 'Previous Due', value: fmtN(previousDue), bold: false, color: [220, 38, 38] },
    ] : []),
    {
      label: 'Balance Due',
      value: `${fmtN(balanceDue)} BDT`,
      bold: true,
      color: isPaid ? [22, 163, 74] : [220, 38, 38],
      bg: isPaid ? [220, 252, 231] : [254, 226, 226],
    },
  ].forEach(({ label, value, bold, color, bg }) => {
    const rh = bold ? 10 : 8;
    doc.setFillColor(...(bg || [250, 250, 252]));
    doc.rect(sumBoxX, sy, sumBoxW, rh, 'F');
    doc.setDrawColor(210, 215, 225);
    doc.setLineWidth(0.25);
    doc.rect(sumBoxX, sy, sumBoxW, rh, 'S');
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? 9.5 : 8.5);
    doc.setTextColor(...color);
    doc.text(label, sumBoxX + 4, sy + (bold ? 6.8 : 5.5));
    doc.text(value, sumBoxX + sumBoxW - 4, sy + (bold ? 6.8 : 5.5), { align: 'right' });
    sy += rh;
  });

  /* ── STATUS STAMP (diagonal watermark) ──────────────── */
  /* large rotated text drawn on top — rubber-stamp look */
  const stampColors = {
    paid:    [134, 239, 172],
    partial: [253, 211, 140],
    unpaid:  [252, 165, 165],
    waived:  [186, 198, 211],
  };
  const stampColor = stampColors[bill.status] || stampColors.unpaid;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(65);
  doc.setTextColor(...stampColor);
  doc.text(sCfg.label, W / 2, 185, { angle: 38, align: 'center' });

  /* ── NOTE ────────────────────────────────────────────── */
  let noteY = sy + 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(30, 30, 30);
  doc.text('Note:', M, noteY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(37, 99, 235);
  const noteLines = doc.splitTextToSize(`» ${noteText}`, W - M * 2 - 3);
  doc.text(noteLines, M + 3, noteY + 6);
  noteY += 6 + noteLines.length * 5;

  if (bill.notes) {
    doc.setTextColor(70, 70, 70);
    const nl = doc.splitTextToSize(`» ${bill.notes}`, W - M * 2 - 3);
    doc.text(nl, M + 3, noteY);
    noteY += nl.length * 5;
  }

  /* ── FOOTER ─────────────────────────────────────────── */
  doc.setDrawColor(205, 210, 220);
  doc.setLineWidth(0.3);
  doc.line(M, noteY + 5, W - M, noteY + 5);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.5);
  doc.setTextColor(120, 120, 120);
  const ftxt = footerText || `Thank you for choosing ${co.name}`;
  doc.text(doc.splitTextToSize(ftxt, W - M * 2), W / 2, noteY + 10, { align: 'center' });

  doc.save(`Invoice-${bill.client_customer_id}-${bill.bill_month}.pdf`);
}

/* ── Consolidated Statement (all bills for one client) ── */
async function downloadStatement(clientId, apiInstance) {
  const resp = await apiInstance.get(`/billing/bills/?client=${clientId}&ordering=bill_month`);
  const bills = resp.data.results || resp.data;
  if (!bills.length) { toast.error('No bills found for this client.'); return; }

  const first = bills[0];
  const doc   = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 14;

  const fmtN = (v) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  const today    = new Date();
  const todayStr = `${String(today.getDate()).padStart(2,'0')} ${MONTHS[today.getMonth()].slice(0,3)} ${today.getFullYear()}`;
  const monthLabel = (m) => { const [y,mo]=m.split('-'); return `${MONTHS[+mo-1].slice(0,3)}-${y.slice(2)}`; };

  const co = {
    name:    first.company_name    || 'ISP Company',
    address: first.company_address || '',
    phone:   first.company_phone   || '',
    email:   first.company_email   || '',
  };
  const hRgb       = hexToRgb(first.invoice_header_color || '#DC5014');
  const noteText   = first.invoice_note   || "This is a computerized statement and doesn't need any signature.";
  const footerText = first.invoice_footer || '';
  const showLogo   = first.invoice_show_logo !== false;

  const totalNet  = bills.reduce((s, b) => s + Number(b.net_amount  || 0), 0);
  const totalPaid = bills.reduce((s, b) => s + Number(b.paid_amount || 0), 0);
  const totalDue  = bills.reduce((s, b) => s + Number(b.due_amount  || 0), 0);
  const advBal    = Number(first.client_advance_balance || 0);

  /* overall status badge */
  const allPaid = totalDue === 0;
  const sBadge  = allPaid
    ? { label: 'ALL PAID', rgb: [22, 163, 74],   bgRgb: [220, 252, 231] }
    : { label: 'HAS DUE',  rgb: [220, 38, 38],   bgRgb: [254, 226, 226] };

  /* ── LOGO (top-left) ── */
  let logoLoaded = false;
  if (showLogo && first.company_logo_b64) {
    try {
      const imgType = first.company_logo_b64.includes('image/png') ? 'PNG' : 'JPEG';
      doc.addImage(first.company_logo_b64, imgType, M, 5, 38, 22);
      logoLoaded = true;
    } catch {}
  }
  if (!logoLoaded) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(17);
    doc.setTextColor(...hRgb);
    doc.text(co.name, M, 18);
  }

  /* ── STATUS BADGE (top-right) ── */
  const badgeW = 38, badgeH = 11, badgeX = W - M - badgeW;
  doc.setFillColor(...sBadge.rgb);
  doc.roundedRect(badgeX, 5, badgeW, badgeH, 2.5, 2.5, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
  doc.setTextColor(255, 255, 255);
  doc.text(sBadge.label, badgeX + badgeW / 2, 12.5, { align: 'center' });

  /* ── Title (center) ── */
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
  doc.setTextColor(...hRgb);
  doc.text('CLIENT STATEMENT', W / 2, 14, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  doc.setTextColor(110, 110, 110);
  doc.text(todayStr, W / 2, 21, { align: 'center' });

  /* ── Company Info Strip ── */
  doc.setFillColor(...hRgb);
  doc.rect(M, 29, W - M * 2, 9, 'F');
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
  doc.setTextColor(255, 255, 255);
  const cp = [co.address, co.phone ? `Tel: ${co.phone}` : '', co.email ? `Email: ${co.email}` : ''].filter(Boolean);
  if (cp.length) doc.text(cp.join('   |   '), W / 2, 35, { align: 'center' });

  /* ── TWO COLUMN BOXES ── */
  const boxY = 43, boxH = 54;
  const col1W = 93, col2X = M + col1W + 4, col2W = W - M * 2 - col1W - 4;

  /* Left box: CLIENT INFO */
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(M, boxY, col1W, boxH, 2, 2, 'F');
  doc.setDrawColor(215, 220, 230); doc.setLineWidth(0.25);
  doc.roundedRect(M, boxY, col1W, boxH, 2, 2, 'S');
  doc.setFillColor(...hRgb);
  doc.roundedRect(M, boxY, col1W, 8, 2, 2, 'F');
  doc.rect(M, boxY + 4, col1W, 4, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(255, 255, 255);
  doc.text('CLIENT INFO', M + 4, boxY + 5.8);

  let cl = boxY + 15;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(15, 23, 42);
  const nameL = doc.splitTextToSize(first.client_name || '—', col1W - 8);
  doc.text(nameL, M + 4, cl);
  cl += nameL.length * 6;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(55, 65, 90);
  [
    first.client_username ? `ID: ${first.client_username}${first.client_ip ? '  |  IP: '+first.client_ip : ''}` : null,
    first.client_phone    ? `Phone: ${first.client_phone}` : null,
    first.client_zone     ? `Zone: ${first.client_zone}` : null,
    first.client_package  ? `Package: ${first.client_package}` : null,
    first.client_connection_type ? `Connection: ${first.client_connection_type}` : null,
    first.client_address  ? `Address: ${first.client_address}` : null,
  ].filter(Boolean).forEach(line => {
    if (cl > boxY + boxH - 3) return;
    const wl = doc.splitTextToSize(line, col1W - 8);
    doc.text(wl, M + 4, cl);
    cl += wl.length * 5.2;
  });

  /* Right box: STATEMENT DETAILS */
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(col2X, boxY, col2W, boxH, 2, 2, 'F');
  doc.setDrawColor(215, 220, 230);
  doc.roundedRect(col2X, boxY, col2W, boxH, 2, 2, 'S');
  doc.setFillColor(...hRgb);
  doc.roundedRect(col2X, boxY, col2W, 8, 2, 2, 'F');
  doc.rect(col2X, boxY + 4, col2W, 4, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(255, 255, 255);
  doc.text('STATEMENT DETAILS', col2X + 4, boxY + 5.8);

  let dr = boxY + 16;
  [
    ['Customer ID',   String(first.client_customer_id || '—')],
    ['Generated',     todayStr],
    ['Total Invoices', String(bills.length)],
    ['Expire Date',   String(first.client_expiry || '—')],
    ['Bill Date',     first.client_bill_date ? `${first.client_bill_date}th of month` : '—'],
    ['Adv. Balance',  `${fmtN(advBal)} BDT`],
    ['Overall',       sBadge.label],
  ].forEach(([label, value]) => {
    const isStatus = label === 'Overall';
    doc.setFont('helvetica', isStatus ? 'bold' : 'normal');
    doc.setFontSize(8);
    doc.setTextColor(isStatus ? sBadge.rgb[0] : 70, isStatus ? sBadge.rgb[1] : 80, isStatus ? sBadge.rgb[2] : 100);
    doc.text(label, col2X + 4, dr);
    doc.setTextColor(isStatus ? sBadge.rgb[0] : 20, isStatus ? sBadge.rgb[1] : 20, isStatus ? sBadge.rgb[2] : 20);
    doc.text(String(value), col2X + col2W - 4, dr, { align: 'right' });
    dr += 5.3;
  });

  /* ── BILLS TABLE ── */
  const tableY = boxY + boxH + 5;
  const STATUS_LABEL_PDF = { paid: 'Paid', partial: 'Partial', unpaid: 'Unpaid', waived: 'Waived' };
  const STATUS_COLOR = { Paid: [22, 163, 74], Partial: [217, 119, 6], Unpaid: [220, 38, 38], Waived: [100, 116, 139] };

  autoTable(doc, {
    startY: tableY,
    head: [['#', 'Month', 'Package / Description', 'Billed (৳)', 'Paid (৳)', 'Due (৳)', 'Status']],
    body: bills.map((b, i) => [
      i + 1,
      monthLabel(b.bill_month),
      `${b.client_package || 'Internet Service'}${b.discount > 0 ? ' (disc: -'+fmtN(b.discount)+')' : ''}`,
      fmtN(b.net_amount),
      fmtN(b.paid_amount),
      fmtN(b.due_amount),
      STATUS_LABEL_PDF[b.status] || b.status,
    ]),
    foot: [['', '', 'TOTAL', fmtN(totalNet), fmtN(totalPaid), fmtN(totalDue), '']],
    theme: 'grid',
    headStyles: { fillColor: hRgb, textColor: [255,255,255], fontStyle: 'bold', fontSize: 8.5, cellPadding: 3.5 },
    bodyStyles: { fontSize: 8.5, cellPadding: 3.5, textColor: [20, 20, 20] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    footStyles: { fillColor: [30, 41, 59], textColor: [255,255,255], fontStyle: 'bold', fontSize: 8.5, cellPadding: 3.5 },
    columnStyles: {
      0: { cellWidth: 9,  halign: 'center' },
      1: { cellWidth: 20 },
      2: { cellWidth: 63 },
      3: { cellWidth: 24, halign: 'right' },
      4: { cellWidth: 24, halign: 'right', textColor: [22, 163, 74] },
      5: { cellWidth: 24, halign: 'right' },
      6: { cellWidth: 18, halign: 'center' },
    },
    willDrawCell: (data) => {
      /* Status column-এ রঙিন text */
      if (data.column.index === 6 && data.section === 'body') {
        const sc = STATUS_COLOR[data.cell.text[0]] || [60, 60, 60];
        data.cell.styles.textColor = sc;
      }
      /* Due column — লাল যদি > 0 */
      if (data.column.index === 5 && data.section === 'body') {
        const dv = Number(bills[data.row.index]?.due_amount || 0);
        if (dv > 0) data.cell.styles.textColor = [220, 38, 38];
      }
    },
    margin: { left: M, right: M },
  });

  const afterY = doc.lastAutoTable.finalY;

  /* ── SUMMARY BOX ── */
  const sumBoxW = 95, sumBoxX = W - M - sumBoxW;
  let sy = afterY + 4;

  [
    { label: 'Total Billed',    value: `${fmtN(totalNet)} BDT`,  bold: false, color: [50, 50, 60] },
    { label: 'Total Paid',      value: `${fmtN(totalPaid)} BDT`, bold: false, color: [22, 163, 74] },
    ...(advBal > 0 ? [
      { label: 'Advance Balance', value: `${fmtN(advBal)} BDT`, bold: false, color: [100, 116, 139] },
    ] : []),
    {
      label: 'Balance Due',
      value: `${fmtN(totalDue)} BDT`,
      bold: true,
      color: allPaid ? [22, 163, 74] : [220, 38, 38],
      bg:    allPaid ? [220, 252, 231] : [254, 226, 226],
    },
  ].forEach(({ label, value, bold, color, bg }) => {
    const rh = bold ? 10 : 8;
    doc.setFillColor(...(bg || [250, 250, 252]));
    doc.rect(sumBoxX, sy, sumBoxW, rh, 'F');
    doc.setDrawColor(210, 215, 225); doc.setLineWidth(0.25);
    doc.rect(sumBoxX, sy, sumBoxW, rh, 'S');
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? 9.5 : 8.5);
    doc.setTextColor(...color);
    doc.text(label, sumBoxX + 4, sy + (bold ? 6.8 : 5.5));
    doc.text(value, sumBoxX + sumBoxW - 4, sy + (bold ? 6.8 : 5.5), { align: 'right' });
    sy += rh;
  });

  /* ── STATUS WATERMARK ── */
  doc.setFont('helvetica', 'bold'); doc.setFontSize(60);
  doc.setTextColor(allPaid ? 134 : 252, allPaid ? 239 : 165, allPaid ? 172 : 165);
  doc.text(allPaid ? 'ALL PAID' : 'HAS DUE', W / 2, 185, { angle: 38, align: 'center' });

  /* ── NOTE ── */
  let noteY = sy + 8;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(30, 30, 30);
  doc.text('Note:', M, noteY);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(37, 99, 235);
  const nl = doc.splitTextToSize(`» ${noteText}`, W - M * 2 - 3);
  doc.text(nl, M + 3, noteY + 6);
  noteY += 6 + nl.length * 5;

  /* ── FOOTER ── */
  doc.setDrawColor(205, 210, 220); doc.setLineWidth(0.3);
  doc.line(M, noteY + 5, W - M, noteY + 5);
  doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(120, 120, 120);
  const ftxt = footerText || `Thank you for choosing ${co.name}`;
  doc.text(doc.splitTextToSize(ftxt, W - M * 2), W / 2, noteY + 10, { align: 'center' });

  doc.save(`Statement-${first.client_customer_id}-${todayStr}.pdf`);
}

/* ── Payment Method Badge ── */
const PAY_METHOD_CFG = {
  cash:       { bg: '#f0fdf4', fg: '#15803d', border: '#bbf7d0', dot: '#22c55e',  label: 'Cash' },
  bkash:      { bg: '#fdf2f8', fg: '#9d174d', border: '#f9a8d4', dot: '#E2136E',  label: 'bKash' },
  nagad:      { bg: '#fff7ed', fg: '#c2410c', border: '#fed7aa', dot: '#F7921E',  label: 'Nagad' },
  rocket:     { bg: '#f5f3ff', fg: '#6d28d9', border: '#ddd6fe', dot: '#8C3494',  label: 'Rocket' },
  bank:       { bg: '#eff6ff', fg: '#1d4ed8', border: '#bfdbfe', dot: '#3b82f6',  label: 'Bank' },
  sslcommerz: { bg: '#f0fdfa', fg: '#0f766e', border: '#99f6e4', dot: '#0d9488',  label: 'SSL' },
  advance:    { bg: '#f5f3ff', fg: '#7c3aed', border: '#ddd6fe', dot: '#8b5cf6',  label: 'Advance' },
  other:      { bg: '#f9fafb', fg: '#4b5563', border: '#d1d5db', dot: '#9ca3af',  label: 'Other' },
};

/* ── Payment Method Icon SVGs ── */
function PayMethodIcon({ method }) {
  const s = { className: 'w-2.5 h-2.5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 };
  if (method === 'cash') return (
    <svg {...s}><path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
  );
  if (method === 'bkash' || method === 'nagad' || method === 'rocket') return (
    <svg {...s}><path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
  );
  if (method === 'bank') return (
    <svg {...s}><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18M5 6h14M5 18h14"/></svg>
  );
  if (method === 'sslcommerz') return (
    <svg {...s}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
  );
  return (
    <svg {...s}><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h.01M12 12h.01M19 12h.01"/></svg>
  );
}

function PayMethodBadge({ method }) {
  const cfg = PAY_METHOD_CFG[method];
  if (!cfg) return null;
  return (
    <span
      className="inline-flex items-center gap-[3px] rounded-full px-1.5 py-[2px] text-[9px] font-bold ring-1 leading-none select-none"
      style={{ background: cfg.bg, color: cfg.fg, ringColor: cfg.border, boxShadow: `0 0 0 1px ${cfg.border}` }}
      title={cfg.label}
    >
      <span className="w-[5px] h-[5px] rounded-full shrink-0" style={{ background: cfg.dot }} />
      <PayMethodIcon method={method} />
      {cfg.label}
    </span>
  );
}

/* ── Dark pill action button ── */
function ActionBtn({ icon, label, onClick, disabled, color = 'dark' }) {
  const cls = color === 'dark'
    ? 'bg-[#173d59] hover:bg-[#1c2f44] text-white border-[#1c2f44]'
    : 'bg-gray-700 hover:bg-gray-600 text-white border-gray-600';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 px-3 py-[7px] rounded-full text-[11px]
        font-medium border transition-colors whitespace-nowrap disabled:opacity-50 ${cls}`}
    >
      {icon && <span className="text-[13px] leading-none">{icon}</span>}
      {label}
    </button>
  );
}

/* ── Colored summary card ── */
function SummCard({ icon, label, value, sub, from, to }) {
  return (
    // বাংলা নোট:
    // Billing summary card-গুলোতে একই gradient family রাখা হয়েছে
    // যাতে অন্য bandwidth/list page-এর সাথে visual consistency থাকে।
    <div className={`rounded-2xl text-white flex items-center gap-3 px-4 py-3 bg-gradient-to-br ${from} ${to} shadow-sm overflow-hidden`}>
      <div className="text-3xl opacity-80 shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-sm font-semibold truncate">{label}</p>
        <p className="text-xl font-bold leading-tight">{value ?? 0}</p>
        <p className="text-[10px] opacity-75 truncate">{sub}</p>
      </div>
    </div>
  );
}

const STATUS_STYLE = {
  paid:    'bg-green-50 text-green-700 border-green-200',
  partial: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  unpaid:  'bg-red-50 text-red-600 border-red-200',
  waived:  'bg-gray-100 text-gray-500 border-gray-200',
};
const STATUS_LABEL = { paid: 'Paid', partial: 'Partial', unpaid: 'Unpaid', waived: 'Waived' };

const METHODS = [
  { value: 'cash',       label: 'Cash' },
  { value: 'bkash',      label: 'bKash' },
  { value: 'nagad',      label: 'Nagad' },
  { value: 'rocket',     label: 'Rocket' },
  { value: 'bank',       label: 'Bank Transfer' },
  { value: 'sslcommerz', label: 'SSLCommerz' },
  { value: 'other',      label: 'Other' },
];

/* ── Shared icon tooltip button (identical to ClientList) ── */
function ActionTooltipBtn({ onClick, tooltip, color, children }) {
  return (
    <div className="relative group">
      <button
        onClick={onClick}
        className={`flex items-center justify-center w-9 h-9 rounded-xl border transition-all duration-150 hover:scale-105 ${color}`}
      >
        {children}
      </button>
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold text-white bg-gray-800 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-[60]">
        {tooltip}
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
      </span>
    </div>
  );
}

/* ── Three-dot Actions menu (identical pattern to ClientList) ── */
function BillActionsMenu({ bill, onEdit, onPay, onHistory, onDownload, onStatement, onProfile, onWaive, hasBill, isAdmin }) {
  const [open, setOpen]      = useState(false);
  const [downloading, setDl] = useState(false);
  const [stating, setSt]     = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const canPay     = hasBill && bill.status !== 'paid' && bill.status !== 'waived';
  const canAdvance = !canPay; // paid/waived/no-bill → Advance option দেখাবে
  // Waive: শুধু বকেয়া (unpaid/partial) বিলে, এবং শুধু Admin/Superadmin
  const canWaive   = hasBill && isAdmin && ['unpaid', 'partial'].includes(bill.status);

  return (
    <div className="flex justify-center">
      <div ref={ref} className="relative">
        {/* Three dots trigger */}
        <button
          onClick={() => setOpen(v => !v)}
          className="flex flex-col items-center justify-center gap-[4px] w-8 h-8 rounded-lg hover:bg-gray-100 transition-colors group"
        >
          <span className="w-[5px] h-[5px] rounded-full bg-gray-400 group-hover:bg-gray-600 transition-colors" />
          <span className="w-[5px] h-[5px] rounded-full bg-gray-400 group-hover:bg-gray-600 transition-colors" />
          <span className="w-[5px] h-[5px] rounded-full bg-gray-400 group-hover:bg-gray-600 transition-colors" />
        </button>

        {/* Popup — appears to the left of the dots, vertically centred */}
        {open && (
          <div className="absolute right-full top-1/2 -translate-y-1/2 mr-1 z-50 flex items-center gap-1 bg-white rounded-xl shadow-lg border border-gray-100 px-1.5 py-1.5">

            {/* Client Profile */}
            <ActionTooltipBtn
              onClick={() => { setOpen(false); onProfile(); }}
              tooltip="Client Profile"
              color="bg-teal-50 text-teal-600 border-teal-100 hover:bg-teal-100 hover:border-teal-300"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </ActionTooltipBtn>

            {/* Edit — only if bill exists */}
            {hasBill && (
              <ActionTooltipBtn
                onClick={() => { setOpen(false); onEdit(); }}
                tooltip="Edit"
                color="bg-blue-50 text-blue-600 border-blue-100 hover:bg-blue-100 hover:border-blue-300"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </ActionTooltipBtn>
            )}

            {/* Pay (only when bill is payable) */}
            {canPay && (
              <ActionTooltipBtn
                onClick={() => { setOpen(false); onPay(); }}
                tooltip="Pay"
                color="bg-green-50 text-green-600 border-green-100 hover:bg-green-100 hover:border-green-300"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
              </ActionTooltipBtn>
            )}

            {/* Waive — শুধু বকেয়া বিলে, Admin/Superadmin only */}
            {canWaive && (
              <ActionTooltipBtn
                onClick={() => { setOpen(false); onWaive(); }}
                tooltip="Waive (বকেয়া মাফ)"
                color="bg-amber-50 text-amber-600 border-amber-100 hover:bg-amber-100 hover:border-amber-300"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </ActionTooltipBtn>
            )}

            {/* History */}
            <ActionTooltipBtn
              onClick={() => { setOpen(false); onHistory(); }}
              tooltip="History"
              color="bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100 hover:border-gray-300"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </ActionTooltipBtn>

            {/* Download Invoice — only if bill exists */}
            {hasBill && (
              <ActionTooltipBtn
                onClick={async () => {
                  setOpen(false);
                  setDl(true);
                  try { await onDownload(); }
                  finally { setDl(false); }
                }}
                tooltip={downloading ? 'Generating…' : 'Download Invoice'}
                color="bg-indigo-50 text-indigo-600 border-indigo-100 hover:bg-indigo-100 hover:border-indigo-300"
              >
                {downloading ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                )}
              </ActionTooltipBtn>
            )}

            {/* Client Statement */}
            <ActionTooltipBtn
              onClick={async () => {
                setOpen(false);
                setSt(true);
                try { await onStatement(); }
                finally { setSt(false); }
              }}
              tooltip={stating ? 'Generating…' : 'Client Statement'}
              color="bg-purple-50 text-purple-600 border-purple-100 hover:bg-purple-100 hover:border-purple-300"
            >
              {stating ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              )}
            </ActionTooltipBtn>


            {/* Arrow pointing → toward the dots */}
            <span className="absolute left-full top-1/2 -translate-y-1/2 border-[5px] border-transparent border-l-white drop-shadow-sm" />
          </div>
        )}
      </div>
    </div>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 p-0 md:p-4">
      <div className={`bg-white rounded-t-2xl md:rounded-2xl shadow-2xl w-full max-h-[90vh] overflow-y-auto ${wide ? 'md:max-w-2xl' : 'md:max-w-lg'}`}>
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-100">
          <h2 className="min-w-0 truncate text-base font-semibold text-gray-900" title={title}>{title}</h2>
          <button onClick={onClose} className="shrink-0 text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div className="card !p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function StatusBadge({ status }) {
  return (
    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full border ${STATUS_STYLE[status] || STATUS_STYLE.unpaid}`}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}

/* ── Mobile Bill Card — মোবাইলে প্রতিটি bill একটি কার্ড হিসেবে দেখায় ── */
function MobileBillCard({
  bill, cd, checked, onToggle,
  isOnline, isSyncing, onSync,
  totalDue, totalPaid, advanceAmount, hasPending, isAdmin,
  exDate, serverLabel, primaryBill, isEven,
  onPay, onEdit, onHistory, onExDate,
  onDownload, onStatement, onProfile, onWaive,
}) {
  const f = v => Number(v || 0).toFixed(2);

  /* ── Financial row: label (gray bg) | value (white) ── */
  const FRow = ({ label, children }) => (
    <div className="flex items-stretch border-b border-gray-200 last:border-0">
      <div className="w-28 shrink-0 bg-gray-50 px-3 py-2.5 flex items-center border-r border-gray-200">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex-1 min-w-0 px-3 py-2.5 flex items-center justify-end bg-white">
        {children}
      </div>
    </div>
  );

  return (
    <div className={`rounded-xl border shadow-sm overflow-hidden ${isEven ? 'bg-white border-gray-200' : 'bg-slate-50/40 border-gray-200'}`}>

      {/* ── Header: checkbox + ↺ + ● + ID + Name + [Pay] + Status ── */}
      <div className="flex items-center gap-1.5 px-3 py-2.5 bg-[#23445f]/5 border-b border-gray-200">
        <input type="checkbox" checked={checked} onChange={onToggle}
          className="w-3.5 h-3.5 rounded accent-blue-500 shrink-0 cursor-pointer" />
        <button onClick={onSync} disabled={isSyncing}
          className={`shrink-0 ${isSyncing ? 'text-blue-400 cursor-wait' : 'text-blue-400 hover:text-blue-600'}`}>
          <svg className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
          isSyncing ? 'bg-blue-400 animate-pulse ring-2 ring-blue-100'
          : isOnline ? 'bg-green-500 ring-2 ring-green-100'
          :            'bg-gray-300 ring-2 ring-gray-100'
        }`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span className="font-mono text-[11px] font-bold text-[#23445f] shrink-0">
              {bill.client_customer_id || cd.customer_id || '#' + bill.client}
              {(bill.client_is_app_user || cd.is_app_user) && (
                <span title="অ্যাপে রেজিস্টার্ড" className="text-emerald-600 font-black text-[15px] ml-0.5 relative -top-[2px] leading-none">®</span>
              )}
            </span>
            <span className="text-[13px] font-bold text-gray-900 truncate">
              {cd.full_name || bill.client_name || '—'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {bill.status === 'paid' ? (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-green-500 text-white">Paid</span>
          ) : bill.status === 'waived' ? (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-400 text-white">Waived</span>
          ) : (
            <>
              <button onClick={onPay}
                className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#173d59] text-white hover:bg-[#1c2f44] active:scale-95 transition-colors">
                Pay
              </button>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold text-white ${bill.status === 'partial' ? 'bg-amber-500' : 'bg-rose-500'}`}>
                {bill.status === 'partial' ? 'Partial' : 'Due'}
              </span>
            </>
          )}
        </div>
      </div>

      {/* ── Connection Info — 2-column grid, প্রতি cell-এ label + value ── */}
      <div className="grid grid-cols-2 divide-x divide-gray-200 border-b border-gray-200">
        <div className="flex flex-col px-3 py-2.5 border-b border-gray-200">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">UserName</span>
          <span className="text-[12px] font-mono font-semibold text-gray-800 truncate">
            {cd.username || bill.client_username || '—'}
          </span>
        </div>
        <div className="flex flex-col px-3 py-2.5 border-b border-gray-200">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Package</span>
          <span className="text-[12px] font-medium text-gray-800 truncate">
            {cd.package_name || bill.client_package || '—'}
          </span>
        </div>
        <div className="flex flex-col px-3 py-2.5">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Conn.</span>
          <span className="text-[12px] font-medium text-gray-800">
            {cd.protocol_name || bill.client_protocol_type || bill.client_protocol || '—'}
          </span>
        </div>
        <div className="flex flex-col px-3 py-2.5">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Ex.Date</span>
          <button onClick={onExDate} className="text-[12px] font-medium text-blue-600 hover:underline underline-offset-2 text-left truncate">
            {exDate || '—'}
          </button>
        </div>
      </div>

      {/* ── Financial Rows — label (gray bg) | value (white) ── */}
      <div>
        <FRow label="Monthly Bill">
          <span className="text-[12px] font-semibold text-gray-800">৳ {f(bill._totalNet)}</span>
        </FRow>
        <FRow label="Received">
          <div className="flex items-center gap-1.5">
            <span className={`text-[12px] font-semibold ${totalPaid > 0 ? 'text-green-600' : 'text-gray-300'}`}>
              {totalPaid > 0 ? `৳ ${f(totalPaid)}` : '—'}
            </span>
            {bill._lastPaymentMethod && <PayMethodBadge method={bill._lastPaymentMethod} />}
            {hasPending && isAdmin && (
              <button
                onClick={() => navigate('/billing/daily-collection')}
                className="text-[9px] font-semibold text-amber-500 animate-pulse hover:text-amber-600 hover:underline underline-offset-1 transition-colors"
                title="ক্লিক করুন → Daily Collection এ Approve করুন"
              >⏳ Pending</button>
            )}
          </div>
        </FRow>
        <FRow label="Balance Due">
          {totalDue > 0
            ? <span className="text-[12px] font-bold text-rose-600">৳ {f(totalDue)}</span>
            : <span className="text-[12px] text-gray-300">—</span>}
        </FRow>
        {advanceAmount > 0 && (
          <FRow label="Advance">
            <span className="text-[12px] font-semibold text-teal-600">৳ {f(advanceAmount)}</span>
          </FRow>
        )}
      </div>

      {/* ── Footer: Server · Date + [⋮ Actions] ── */}
      <div className="flex items-center justify-between px-3 py-2.5 bg-gray-50/60 border-t border-gray-200">
        <div className="flex items-center gap-1.5 text-[11px] text-gray-400 min-w-0">
          <span className="truncate">{serverLabel}</span>
          {bill.last_payment_date && <><span className="shrink-0">·</span><span className="shrink-0">{bill.last_payment_date}</span></>}
        </div>
        <BillActionsMenu
          bill={primaryBill}
          hasBill={!!primaryBill.id}
          isAdmin={isAdmin}
          onProfile={onProfile} onEdit={onEdit} onPay={onPay}
          onHistory={onHistory} onDownload={onDownload}
          onStatement={onStatement} onWaive={onWaive}
        />
      </div>
    </div>
  );
}

export default function BillList() {
  const navigate  = useNavigate();
  const { user }  = useAuth();
  const isAdmin   = ['superadmin', 'admin'].includes(user?.role);
  const [bills, setBills]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [summary, setSummary]   = useState(null);
  const [page, setPage]         = useState(1);
  const [count, setCount]       = useState(0);
  const [perPage, setPerPage]   = useState(20);

  const [month, setMonth]     = useState('');
  // Customer Search-এর "Recharge" বাটন ?search=<customer_id> দিয়ে আসে — তখন
  // সরাসরি ঐ গ্রাহকের bill filter হয়ে আসে, agent সাথে সাথে Pay করতে পারে।
  const [searchParams] = useSearchParams();
  const [search, setSearch]   = useState(searchParams.get('search') || '');
  const [statusF, setStatusF] = useState('');
  // Dashboard Paid/Partial/Unpaid card থেকে drill-down (client-aggregate filter)
  const [payStatus, setPayStatus] = useState(searchParams.get('pay_status') || '');

  /* ── Filter visibility ── */
  const [showFilters, setShowFilters] = useState(false);

  /* ── Filter state ── */
  const [filterServer, setFilterServer]               = useState('');
  const [filterProtocol, setFilterProtocol]           = useState('');
  const [filterZone, setFilterZone]                   = useState('');
  const [filterSubzone, setFilterSubzone]             = useState('');
  const [filterBox, setFilterBox]                     = useState('');
  const [filterPackage, setFilterPackage]             = useState('');
  const [filterBillingStatus, setFilterBillingStatus] = useState('');
  const [filterPaymentStatus, setFilterPaymentStatus] = useState('');
  const [filterMikrotikStatus, setFilterMikrotikStatus] = useState('');
  const [filterConnectionType, setFilterConnectionType] = useState('');
  const [filterClientType, setFilterClientType]       = useState('');
  const [filterFromExpiry, setFilterFromExpiry]       = useState('');
  const [filterToExpiry, setFilterToExpiry]           = useState('');
  const [filterFromDate, setFilterFromDate]           = useState('');
  const [filterToDate, setFilterToDate]               = useState('');

  /* ── Filter option lists ── */
  const [fZones, setFZones]         = useState([]);
  const [fSubzones, setFSubzones]   = useState([]);
  const [fBoxes, setFBoxes]         = useState([]);
  const [fPackages, setFPackages]   = useState([]);
  const [fProtocols, setFProtocols] = useState([]);
  const [fClientTypes, setFClientTypes] = useState([]);
  const [fServers, setFServers]     = useState([]);

  /* ── Bulk selection ── */
  const [selectedBills, setSelectedBills] = useState([]);

  // pay modal (Bill Receive — DailyCollection style)
  const [payBill,       setPayBill]       = useState(null);
  const [payForm,       setPayForm]       = useState({ amount: '', payment_method: 'cash', transaction_id: '', notes: '', received_by: '', discount: '0' });
  const [paying,        setPaying]        = useState(false);
  const [payUsers,      setPayUsers]      = useState([]);

  // history modal
  const [histBill, setHistBill] = useState(null);
  const [histPays, setHistPays] = useState([]);
  const [histLoad, setHistLoad] = useState(false);

  // edit modal
  const [editBill, setEditBill]   = useState(null);
  const [editForm, setEditForm]   = useState({});
  const [saving, setSaving]       = useState(false);
  const [waiveBill,   setWaiveBill]   = useState(null);
  const [waiveReason, setWaiveReason] = useState('');
  const [waiving,     setWaiving]     = useState(false);

  // delete confirmation

  // client detail cache (for missing fields not in bill serializer)
  const [clientDataCache, setClientDataCache] = useState({});
  const [syncingClientId, setSyncingClientId] = useState(null);

  // ExDate / Billing Remarks modal
  const [exDateModal,  setExDateModal]  = useState(null);  // bill object
  const [exDateForm,   setExDateForm]   = useState({ expiry_date: '', notes: '', is_vip: false });
  const [exDateSaving, setExDateSaving] = useState(false);

  /* ── Load filter option lists once on mount ── */
  useEffect(() => {
    const load = async () => {
      try {
        const [zones, subzones, boxes, packages, protocols, clientTypes, servers] = await Promise.all([
          api.get('/config/zones/'),
          api.get('/config/subzones/'),
          api.get('/config/boxes/'),
          api.get('/config/packages/'),
          api.get('/config/protocol-types/'),
          api.get('/config/client-types/'),
          api.get('/mikrotik/servers/'),
        ]);
        const extractList = (r) => r.data.results || r.data || [];
        setFZones(extractList(zones));
        setFSubzones(extractList(subzones));
        setFBoxes(extractList(boxes));
        setFPackages(extractList(packages));
        setFProtocols(extractList(protocols));
        setFClientTypes(extractList(clientTypes));
        setFServers(extractList(servers));
      } catch { /* silently ignore — filters still work */ }
    };
    load();
  }, []);

  const fetchBills = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, page_size: perPage });
      if (month)                  params.append('bill_month', month);
      if (search)                 params.append('search', search);

      const effectiveStatus = filterBillingStatus || statusF;
      if (effectiveStatus)        params.append('status', effectiveStatus);
      if (payStatus)              params.append('pay_status', payStatus);

      if (filterZone)             params.append('zone', filterZone);
      if (filterSubzone)          params.append('subzone', filterSubzone);
      if (filterBox)              params.append('box', filterBox);
      if (filterPackage)          params.append('package', filterPackage);
      if (filterProtocol)         params.append('protocol', filterProtocol);
      if (filterClientType)       params.append('client_type', filterClientType);
      if (filterServer)           params.append('server', filterServer);
      if (filterFromExpiry)       params.append('expiry_from', filterFromExpiry);
      if (filterToExpiry)         params.append('expiry_to', filterToExpiry);
      if (filterFromDate)         params.append('date_from', filterFromDate);
      if (filterToDate)           params.append('date_to', filterToDate);

      const sumUrl = month
        ? `/billing/bills/collection-summary/?month=${month}`
        : `/billing/bills/collection-summary/`;
      const [billRes, sumRes] = await Promise.all([
        api.get(`/billing/bills/client-billing-view/?${params}`),
        api.get(sumUrl),
      ]);
      setBills(billRes.data.results || billRes.data);
      setCount(billRes.data.count || 0);
      setSummary(sumRes.data);
    } catch {
      toast.error('Failed to load bills.');
    } finally {
      setLoading(false);
    }
  }, [page, perPage, month, statusF, search, payStatus,
      filterBillingStatus, filterZone, filterSubzone, filterBox,
      filterPackage, filterProtocol, filterClientType, filterServer,
      filterFromExpiry, filterToExpiry, filterFromDate, filterToDate]);

  useEffect(() => { fetchBills(); }, [fetchBills]);

  /* ── Load employees + admin/superadmin users for Received By dropdown ── */
  useEffect(() => {
    Promise.all([
      api.get('/hr/employees/?status=active&page_size=500').catch(() => ({ data: [] })),
      api.get('/auth/users/?page_size=500').catch(() => ({ data: [] })),
    ]).then(([empRes, userRes]) => {
      const emps   = empRes.data.results  || empRes.data  || [];
      const users  = userRes.data.results || userRes.data || [];
      // employee-দের user ID set — duplicate এড়াতে
      const empUserIds = new Set(emps.map(e => e.user).filter(Boolean));
      // admin/superadmin যারা employee list-এ নেই
      const adminUsers = users
        .filter(u => ['admin', 'superadmin'].includes(u.role) && !empUserIds.has(u.id) && u.is_active !== false)
        .map(u => ({ _type: 'user', id: u.id, full_name: u.full_name || u.username, designation: u.role === 'superadmin' ? 'Super Admin' : 'Admin' }));
      const empList = emps.map(e => ({ _type: 'emp', ...e }));
      // Admin/Superadmin আগে, তারপর employees
      setPayUsers([...adminUsers, ...empList]);
    });
  }, []);

  /* ── Fetch missing client fields after bills load ── */
  useEffect(() => {
    if (!bills.length) return;
    const uniqueIds = [...new Set(bills.map(b => b.client).filter(Boolean))];
    const missing = uniqueIds.filter(id => !clientDataCache[id]);
    if (!missing.length) return;
    Promise.all(missing.map(id => api.get(`/clients/${id}/`).catch(() => null)))
      .then(responses => {
        const newData = {};
        responses.forEach(r => { if (r?.data?.id) newData[r.data.id] = r.data; });
        if (Object.keys(newData).length) setClientDataCache(prev => ({ ...prev, ...newData }));
      });
  }, [bills]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyClientBillingSnapshot = (updatedBill) => {
    setBills(prev => prev.map(b => {
      if (b.id === updatedBill.id) return updatedBill;
      if (b.client !== updatedBill.client) return b;
      return {
        ...b,
        client_balance_due: updatedBill.client_balance_due,
        advance_amount: updatedBill.advance_amount,
        last_payment_date: updatedBill.last_payment_date,
      };
    }));
  };

  /* ── Pay (Bill Receive modal) ── */
  const openPay = (bill) => {
    setPayBill(bill);
    const totalDue = Number(bill._clientBalanceDue ?? bill.client_balance_due ?? bill.due_amount ?? 0);
    setPayForm({
      amount:         totalDue > 0 ? String(totalDue) : '',
      payment_method: 'cash',
      transaction_id: '',
      notes:          'Received in hand',
      received_by:    '',
      discount:       String(Number(bill.discount || 0)),
    });
  };

  const handlePay = async () => {
    if (!payForm.received_by) { toast.error('Received By সিলেক্ট করুন।'); return; }
    if (!payForm.amount || Number(payForm.amount) <= 0) { toast.error('পরিমাণ লিখুন।'); return; }
    setPaying(true);
    try {
      // bill আছে এবং discount পরিবর্তন হলে আগে update করো
      const newDiscount = Number(payForm.discount || 0);
      const oldDiscount = Number(payBill.discount || 0);
      if (payBill.id && Math.abs(newDiscount - oldDiscount) > 0.001) {
        const newNetAmount = Math.max(Number(payBill.amount || 0) - newDiscount, 0);
        await api.patch(`/billing/bills/${payBill.id}/`, {
          discount: newDiscount,
          net_amount: Math.round(newNetAmount * 100) / 100,
        });
      }
      // নতুন endpoint: client-এর সব due বিলে distribute করে, excess → advance_balance
      await api.post('/billing/payments/receive/', {
        client_id:        payBill.client,
        amount:           payForm.amount,
        payment_method:   payForm.payment_method,
        transaction_id:   payForm.transaction_id,
        notes:            payForm.notes,
        received_by:      payForm.received_by || undefined,
      });
      toast.success('পেমেন্ট সফলভাবে গ্রহণ করা হয়েছে।');
      const paidClientId = payBill.client;
      setPayBill(null);
      // clientDataCache থেকে এই client-কে evict করো — নইলে EX.DATE কলাম
      // (যা cd.expiry_date-কে অগ্রাধিকার দেয়) পুরনো expiry দেখাবে। evict করলে
      // fetch-missing effect নতুন expiry_date সহ ফের load করে।
      setClientDataCache(prev => {
        if (!prev[paidClientId]) return prev;
        const next = { ...prev };
        delete next[paidClientId];
        return next;
      });
      // সব বিলের BalanceDue আপডেট পেতে fresh fetch করো
      fetchBills();
    } catch (err) {
      const d = err.response?.data;
      if (d && typeof d === 'object') Object.values(d).forEach(m => toast.error(Array.isArray(m) ? m[0] : m));
      else toast.error('পেমেন্ট ব্যর্থ হয়েছে।');
    } finally { setPaying(false); }
  };

  /* ── History ── */
  const openHistory = async (bill) => {
    setHistBill(bill);
    setHistPays([]);
    setHistLoad(true);
    try {
      const r = await api.get(`/billing/bills/${bill.id}/payments/`);
      setHistPays(r.data);
    } catch { toast.error('Failed to load payment history.'); }
    finally { setHistLoad(false); }
  };

  /* ── Edit ── */
  const openEdit = (bill) => {
    setEditBill(bill);
    setEditForm({
      amount:    String(Number(bill.amount)),
      discount:  String(Number(bill.discount)),
      net_amount: String(Number(bill.net_amount)),
      due_date:  bill.due_date || '',
      status:    bill.status,
      reason:    '',
    });
  };

  const calcNet = (amount, discount) =>
    String(Math.max((parseFloat(amount) || 0) - (parseFloat(discount) || 0), 0));

  const handleEditChange = (field, value) => {
    setEditForm(f => {
      const updated = { ...f, [field]: value };
      if (field === 'amount' || field === 'discount') {
        updated.net_amount = calcNet(
          field === 'amount' ? value : updated.amount,
          field === 'discount' ? value : updated.discount,
        );
      }
      return updated;
    });
  };

  const handleEditSave = async () => {
    const targetId = editBill.id;
    // Paid/Partial বিল (financially sensitive) — শুধু Admin/Superadmin, reason বাধ্যতামূলক
    const sensitive = ['paid', 'partial'].includes(editBill.status);
    if (sensitive && !isAdmin) {
      toast.error('Paid/Partial বিল edit শুধু Admin/Superadmin করতে পারবে।');
      return;
    }
    if (sensitive && !editForm.reason?.trim()) {
      toast.error('Paid/Partial বিল edit-এ কারণ (reason) দেওয়া বাধ্যতামূলক।');
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/billing/bills/${targetId}/`, {
        amount:     editForm.amount,
        discount:   editForm.discount,
        net_amount: editForm.net_amount,
        due_date:   editForm.due_date || null,
        status:     editForm.status,
        reason:     editForm.reason?.trim() || undefined,
      });
      toast.success('Bill updated.');
      setEditBill(null);
      const sumUrl = month
        ? `/billing/bills/collection-summary/?month=${month}`
        : `/billing/bills/collection-summary/`;
      const [billRes, sumRes] = await Promise.all([
        api.get(`/billing/bills/${targetId}/`),
        api.get(sumUrl),
      ]);
      applyClientBillingSnapshot(billRes.data);
      setSummary(sumRes.data);
    } catch (err) {
      const d = err.response?.data;
      if (d && typeof d === 'object') Object.values(d).forEach(m => toast.error(Array.isArray(m) ? m[0] : m));
      else toast.error('Failed to update bill.');
    } finally { setSaving(false); }
  };


  /* ── Waive (বকেয়া মাফ) — Admin/Superadmin only ── */
  const openWaive = (bill) => {
    setWaiveBill(bill);
    setWaiveReason('');
  };

  const handleWaive = async () => {
    if (!waiveBill) return;
    setWaiving(true);
    try {
      await api.post(`/billing/bills/${waiveBill.id}/waive/`, {
        reason: waiveReason.trim() || undefined,
      });
      toast.success('বিল মওকুফ (Waived) হয়েছে।');
      const clientId = waiveBill.client;
      setWaiveBill(null);
      // expiry/balance fresh দেখাতে client cache evict (Pay-এর মতোই)
      setClientDataCache(prev => {
        if (!prev[clientId]) return prev;
        const next = { ...prev }; delete next[clientId]; return next;
      });
      fetchBills();
    } catch (err) {
      const d = err.response?.data;
      if (d && typeof d === 'object') Object.values(d).forEach(m => toast.error(Array.isArray(m) ? m[0] : m));
      else toast.error('Waive ব্যর্থ হয়েছে।');
    } finally { setWaiving(false); }
  };

  const fmt = (v) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });

  /* ── Refresh online status for a single client ── */
  const handleSyncOnline = async (clientId) => {
    setSyncingClientId(clientId);
    try {
      const r = await api.get(`/clients/${clientId}/`);
      if (r?.data?.id) setClientDataCache(prev => ({ ...prev, [clientId]: r.data }));
    } catch {} finally { setSyncingClientId(null); }
  };

  /* ── Open ExDate / Billing Remarks modal ── */
  const openExDate = async (bill) => {
    const cd = clientDataCache[bill.client];
    if (cd) {
      setExDateForm({
        expiry_date: cd.expiry_date || '',
        notes:       cd.notes      || '',
        is_vip:      cd.is_vip     || false,
      });
      setExDateModal(bill);
    } else {
      try {
        const r = await api.get(`/clients/${bill.client}/`);
        const data = r.data;
        setClientDataCache(prev => ({ ...prev, [bill.client]: data }));
        setExDateForm({
          expiry_date: data.expiry_date || '',
          notes:       data.notes      || '',
          is_vip:      data.is_vip     || false,
        });
        setExDateModal(bill);
      } catch { toast.error('Client তথ্য লোড করতে পারেনি।'); }
    }
  };

  /* ── Save ExDate / Billing Remarks ── */
  const handleExDateSave = async () => {
    if (!exDateModal) return;
    setExDateSaving(true);
    try {
      const payload = {
        expiry_date: exDateForm.expiry_date || null,
        notes:       exDateForm.notes,
        is_vip:      exDateForm.is_vip,
      };
      await api.patch(`/clients/${exDateModal.client}/`, payload);
      // cache আপডেট করো
      setClientDataCache(prev => ({
        ...prev,
        [exDateModal.client]: { ...(prev[exDateModal.client] || {}), ...payload },
      }));
      toast.success('Client তথ্য আপডেট হয়েছে।');
      setExDateModal(null);
      fetchBills();
    } catch (err) {
      const d = err.response?.data;
      if (d && typeof d === 'object') Object.values(d).forEach(m => toast.error(Array.isArray(m) ? m[0] : m));
      else toast.error('আপডেট ব্যর্থ হয়েছে।');
    } finally { setExDateSaving(false); }
  };

  /* ── Deduplicate bills: one row per client, sum amounts ── */
  // নতুন endpoint প্রতিটি row ইতিমধ্যে per-client — সরাসরি ব্যবহার করা হচ্ছে
  const mergedBills = useMemo(() => bills.map(row => ({
    ...row,
    _allBills:         [row],   // primaryBill-এর জন্য compatibility
    _totalDue:         Number(row.due_amount  || 0),
    _totalPaid:        Number(row.paid_amount || 0),
    _totalNet:         Number(row.net_amount  || 0),
    _clientBalanceDue: Number(row.client_balance_due ?? row.due_amount ?? 0),
    _advanceAmount:    Number(row.advance_amount ?? 0),
    _hasPendingPayment: row.has_pending_payment || false,
    _lastPaymentMethod: row.last_payment_method || null,
  })), [bills]);

  /* ── Bulk select helpers ── */
  const allSelected = mergedBills.length > 0 && selectedBills.length === mergedBills.length;
  const toggleAll   = () => setSelectedBills(allSelected ? [] : mergedBills.map(b => b.id));
  const toggleOne   = (id) => setSelectedBills(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  );

  /* ── Inline Mikrotik toggle ── */
  const handleMStatusToggle = async (clientId, currentlyActive) => {
    const action = currentlyActive ? 'disable' : 'enable';
    try {
      await api.post(`/clients/${clientId}/${action}/`);
      toast.success(action === 'disable' ? 'Client disabled.' : 'Client enabled.');
      setClientDataCache(prev => ({
        ...prev,
        [clientId]: {
          ...(prev[clientId] || {}),
          status: action === 'enable' ? 'active' : 'suspended',
          mikrotik_status: action === 'enable',
        },
      }));
    } catch {
      toast.error('Operation failed.');
    }
  };

  const MStatusToggle = ({ active, clientId }) => (
    <button
      onClick={() => handleMStatusToggle(clientId, active)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${active ? 'bg-blue-500' : 'bg-gray-300'}`}
      title={active ? 'Active — click to disable' : 'Inactive — click to enable'}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${active ? 'translate-x-[18px]' : 'translate-x-[2px]'}`} />
    </button>
  );

  /* ── Label / input class helpers ── */
  const filterLabelCls = 'text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1';
  const filterInputCls = 'w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-500';

  return (
    <div className="space-y-3 -mt-2">

      {/* ── Page header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <div>
            <h1 className="text-lg font-bold text-gray-900 leading-none">Billing List</h1>
            <p className="text-[11px] text-gray-400 mt-0.5">All Clients Bill</p>
          </div>
        </div>
        <div className="text-xs text-gray-400">Billing &rsaquo; Billing List</div>
      </div>

      {/* ── Action buttons — desktop only ── */}
      <div className="block bg-white rounded-xl shadow-sm p-3 space-y-2">
        <div className="flex flex-wrap gap-2">
          <ActionBtn icon="⬇" label="Download Invoice"
            onClick={() => toast('Select a bill row to download invoice.')} />
        </div>
      </div>

      {/* ── Summary cards — always visible ── */}
      {summary && (
        <>
          {/* Row 1: 4 cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummCard icon="👥" label="Paid Client"    value={summary.paid_count ?? 0}      sub="Monthly paid client"      from="from-sky-500"    to="to-cyan-600" />
            <SummCard icon="👥" label="Unpaid Client"  value={summary.unpaid_count ?? 0}    sub="Monthly unpaid client"    from="from-teal-500"   to="to-emerald-600" />
            <SummCard icon="💵" label="Recived Bill"   value={fmt(summary.total_collected)} sub="Monthly received bill"    from="from-violet-500" to="to-indigo-600" />
            <SummCard icon="💵" label="Due Amount"     value={fmt(summary.total_due)}       sub="All over due amount"      from="from-slate-600"  to="to-slate-700" />
          </div>
          {/* Row 2: 3 cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <SummCard icon="💵" label="Generated Bill" value={summary.total_bills ?? 0}     sub="Monthly generated bill"   from="from-sky-500"    to="to-cyan-600" />
            <SummCard icon="💵" label="Advance Amount" value={fmt(summary.advance_amount)}  sub="Advance collected"        from="from-teal-500"   to="to-emerald-600" />
            <SummCard icon="💵" label="Monthly Bill"   value={fmt(summary.total_billed)}    sub="Current month total bill" from="from-violet-500" to="to-indigo-600" />
          </div>
        </>
      )}

      {/* ── Smart Filter Toggle ── */}
      {(() => {
        // Cascade: subzone filtered by zone, box filtered by subzone
        const visibleSubzones = filterZone
          ? fSubzones.filter(s => String(s.zone ?? s.zone_id) === String(filterZone))
          : fSubzones;
        const visibleBoxes = filterSubzone
          ? fBoxes.filter(b => String(b.subzone ?? b.subzone_id) === String(filterSubzone))
          : fBoxes;

        // Active filter count
        const activeFilters = [
          filterServer, filterProtocol, filterZone, filterSubzone, filterBox,
          filterPackage, filterBillingStatus, filterClientType,
          filterFromExpiry, filterToExpiry, filterFromDate, filterToDate,
        ].filter(Boolean);
        const activeCount = activeFilters.length;

        // Clear all filters
        const clearAll = () => {
          setFilterServer(''); setFilterProtocol(''); setFilterZone('');
          setFilterSubzone(''); setFilterBox(''); setFilterPackage('');
          setFilterBillingStatus(''); setFilterClientType('');
          setFilterFromExpiry(''); setFilterToExpiry('');
          setFilterFromDate(''); setFilterToDate('');
          setPage(1);
        };

        // Active filter chip labels
        const chipLabels = [
          filterServer      && { key: 'server',    label: fServers.find(s => String(s.id) === String(filterServer))?.name || 'Server',          clear: () => { setFilterServer(''); setPage(1); } },
          filterProtocol    && { key: 'protocol',  label: fProtocols.find(p => String(p.id) === String(filterProtocol))?.name || 'Protocol',    clear: () => { setFilterProtocol(''); setPage(1); } },
          filterPackage     && { key: 'package',   label: fPackages.find(p => String(p.id) === String(filterPackage))?.name || 'Package',       clear: () => { setFilterPackage(''); setPage(1); } },
          filterBillingStatus && { key: 'bstatus', label: filterBillingStatus.charAt(0).toUpperCase() + filterBillingStatus.slice(1),           clear: () => { setFilterBillingStatus(''); setPage(1); } },
          payStatus         && { key: 'paystatus', label: ({ paid: 'Paid Clients', partial: 'Partially Paid', unpaid: 'Unpaid Clients' }[payStatus] || payStatus), clear: () => { setPayStatus(''); setPage(1); } },
          filterZone        && { key: 'zone',      label: fZones.find(z => String(z.id) === String(filterZone))?.name || 'Zone',                clear: () => { setFilterZone(''); setFilterSubzone(''); setFilterBox(''); setPage(1); } },
          filterSubzone     && { key: 'subzone',   label: fSubzones.find(s => String(s.id) === String(filterSubzone))?.name || 'SubZone',       clear: () => { setFilterSubzone(''); setFilterBox(''); setPage(1); } },
          filterBox         && { key: 'box',       label: fBoxes.find(b => String(b.id) === String(filterBox))?.name || 'Box',                  clear: () => { setFilterBox(''); setPage(1); } },
          filterClientType  && { key: 'ctype',     label: fClientTypes.find(c => String(c.id) === String(filterClientType))?.name || 'Type',    clear: () => { setFilterClientType(''); setPage(1); } },
          filterFromExpiry  && { key: 'exFrom',    label: `Exp ≥ ${filterFromExpiry}`,  clear: () => { setFilterFromExpiry(''); setPage(1); } },
          filterToExpiry    && { key: 'exTo',      label: `Exp ≤ ${filterToExpiry}`,    clear: () => { setFilterToExpiry(''); setPage(1); } },
          filterFromDate    && { key: 'dFrom',     label: `Pay ≥ ${filterFromDate}`,    clear: () => { setFilterFromDate(''); setPage(1); } },
          filterToDate      && { key: 'dTo',       label: `Pay ≤ ${filterToDate}`,      clear: () => { setFilterToDate(''); setPage(1); } },
        ].filter(Boolean);

        return (
          <>
            {/* Toggle button + active chips row */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setShowFilters(v => !v)}
                className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold transition-all shadow-sm ${
                  showFilters ? 'bg-[#23445f] text-white' : 'bg-[#173d59] text-white hover:bg-[#1c2f44]'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
                </svg>
                Filters
                {activeCount > 0 && (
                  <span className="bg-amber-400 text-gray-900 text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
                    {activeCount}
                  </span>
                )}
                <svg className={`w-3 h-3 transition-transform ${showFilters ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Active filter chips */}
              {chipLabels.map(chip => (
                <span key={chip.key} className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 border border-blue-200 text-blue-700 text-[11px] font-medium rounded-full">
                  {chip.label}
                  <button onClick={chip.clear} className="hover:text-red-500 transition-colors ml-0.5">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}

              {activeCount > 1 && (
                <button onClick={clearAll} className="text-[11px] text-red-500 hover:text-red-700 font-medium underline underline-offset-2 transition-colors">
                  Clear all
                </button>
              )}
            </div>

            {/* Filter panel */}
            {showFilters && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-4">

                {/* Row 1 — Billing & Connection */}
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Billing & Connection</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    <div>
                      <p className={filterLabelCls}>Billing Status</p>
                      <select className={filterInputCls} value={filterBillingStatus} onChange={e => { setFilterBillingStatus(e.target.value); setPage(1); }}>
                        <option value="">All Status</option>
                        <option value="unpaid">⬤ Unpaid</option>
                        <option value="partial">⬤ Partial</option>
                        <option value="paid">⬤ Paid</option>
                        <option value="waived">⬤ Waived</option>
                      </select>
                    </div>
                    <div>
                      <p className={filterLabelCls}>Package</p>
                      <select className={filterInputCls} value={filterPackage} onChange={e => { setFilterPackage(e.target.value); setPage(1); }}>
                        <option value="">All Packages</option>
                        {fPackages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <p className={filterLabelCls}>Protocol Type</p>
                      <select className={filterInputCls} value={filterProtocol} onChange={e => { setFilterProtocol(e.target.value); setPage(1); }}>
                        <option value="">All Protocols</option>
                        {fProtocols.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <p className={filterLabelCls}>Server</p>
                      <select className={filterInputCls} value={filterServer} onChange={e => { setFilterServer(e.target.value); setPage(1); }}>
                        <option value="">All Servers</option>
                        {fServers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Row 2 — Geographic (cascade) */}
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Geographic (Cascade)</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <p className={filterLabelCls}>Zone</p>
                      <select className={filterInputCls} value={filterZone} onChange={e => {
                        setFilterZone(e.target.value);
                        setFilterSubzone('');
                        setFilterBox('');
                        setPage(1);
                      }}>
                        <option value="">All Zones</option>
                        {fZones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <p className={filterLabelCls}>
                        Sub Zone
                        {filterZone && <span className="ml-1 text-blue-500">↳ filtered</span>}
                      </p>
                      <select className={filterInputCls} value={filterSubzone} onChange={e => {
                        setFilterSubzone(e.target.value);
                        setFilterBox('');
                        setPage(1);
                      }} disabled={!filterZone && visibleSubzones.length === 0}>
                        <option value="">All Sub Zones</option>
                        {visibleSubzones.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <p className={filterLabelCls}>
                        Box
                        {filterSubzone && <span className="ml-1 text-blue-500">↳ filtered</span>}
                      </p>
                      <select className={filterInputCls} value={filterBox} onChange={e => { setFilterBox(e.target.value); setPage(1); }}
                        disabled={!filterSubzone && visibleBoxes.length === 0}>
                        <option value="">All Boxes</option>
                        {visibleBoxes.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <p className={filterLabelCls}>Client Type</p>
                      <select className={filterInputCls} value={filterClientType} onChange={e => { setFilterClientType(e.target.value); setPage(1); }}>
                        <option value="">All Types</option>
                        {fClientTypes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Row 3 — Date Ranges */}
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Date Ranges</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <p className={filterLabelCls}>Expiry From</p>
                      <input type="date" className={filterInputCls} value={filterFromExpiry}
                        onChange={e => { setFilterFromExpiry(e.target.value); setPage(1); }} />
                    </div>
                    <div>
                      <p className={filterLabelCls}>Expiry To</p>
                      <input type="date" className={filterInputCls} value={filterToExpiry}
                        onChange={e => { setFilterToExpiry(e.target.value); setPage(1); }} />
                    </div>
                    <div>
                      <p className={filterLabelCls}>Payment From</p>
                      <input type="date" className={filterInputCls} value={filterFromDate}
                        onChange={e => { setFilterFromDate(e.target.value); setPage(1); }} />
                    </div>
                    <div>
                      <p className={filterLabelCls}>Payment To</p>
                      <input type="date" className={filterInputCls} value={filterToDate}
                        onChange={e => { setFilterToDate(e.target.value); setPage(1); }} />
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between pt-1 border-t border-gray-100">
                  <p className="text-[11px] text-gray-400">
                    {activeCount > 0 ? <>{activeCount} filter{activeCount > 1 ? 's' : ''} active</> : 'No filters applied'}
                  </p>
                  {activeCount > 0 && (
                    <button onClick={clearAll}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-medium hover:bg-red-100 transition-colors">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      Clear All Filters
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        );
      })()}

      {/* ── Table card ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

        {/* Top bar: search only */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
          <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search by name, ID, username, phone..."
            className="flex-1 text-sm text-slate-700 placeholder-slate-400 bg-transparent border-none outline-none"
            value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
          {search && (
            <button onClick={() => { setSearch(''); setPage(1); }} className="text-slate-400 hover:text-slate-600 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Table */}
        {loading ? (
          <div className="text-center py-16 text-gray-400 text-sm">Loading...</div>
        ) : (
          <>
          {/* ── Mobile Card List — বন্ধ (সব স্ক্রিনে টেবিল দেখানো হয়) ── */}
          <div className="hidden space-y-2 p-3">
            {mergedBills.length === 0
              ? <div className="text-center py-10 text-gray-400 text-sm">No bills found.</div>
              : mergedBills.map((bill, idx) => {
                  const cd          = clientDataCache[bill.client] || {};
                  const isSyncing   = syncingClientId === bill.client;
                  const isOnline    = cd.status === 'active' || cd.mikrotik_status === true || cd.mikrotik_status === 'active';
                  const totalDue    = bill._clientBalanceDue;
                  const totalPaid   = bill._totalPaid;
                  const advanceAmount = bill._advanceAmount;
                  const checked     = selectedBills.includes(bill.id);
                  const hasPending  = bill._hasPendingPayment;
                  const exDate      = cd.expiry_date || bill.client_expiry || bill.due_date || '';
                  const serverLabel = cd.router_name || bill.client_server || bill.router_name || '—';
                  const primaryBill = bill._allBills[0];
                  return (
                    <MobileBillCard
                      key={bill.client}
                      bill={bill} cd={cd}
                      checked={checked} onToggle={() => toggleOne(bill.id)}
                      isOnline={isOnline} isSyncing={isSyncing} onSync={() => handleSyncOnline(bill.client)}
                      totalDue={totalDue} totalPaid={totalPaid} advanceAmount={advanceAmount} hasPending={hasPending} isAdmin={isAdmin}
                      exDate={exDate} serverLabel={serverLabel} primaryBill={primaryBill} isEven={idx % 2 === 0}
                      onPay={() => openPay(primaryBill)}
                      onEdit={() => openEdit(primaryBill)}
                      onHistory={() => openHistory(primaryBill)}
                      onWaive={() => openWaive(primaryBill)}
                      onExDate={() => openExDate(bill)}
                      onDownload={() => downloadInvoice(primaryBill.id, api)}
                      onStatement={() => downloadStatement(bill.client, api)}
                      onProfile={() => navigate(`/clients/${primaryBill.client}/profile`)}
                    />
                  );
                })
            }
          </div>
          {/* ── Table (সব স্ক্রিন; মোবাইলে অনুভূমিক স্ক্রল) ── */}
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[1200px] text-[10.5px] table-fixed tabular-nums border-collapse">
              <colgroup>
                <col style={{ width: '2.2%' }} />{/* checkbox */}
                <col style={{ width: '4.2%' }} />{/* Cus. ID */}
                <col style={{ width: '7.5%' }} />{/* ID/IP */}
                <col style={{ width: '9.0%' }} />{/* Name/Mobile */}
                <col style={{ width: '8.5%' }} />{/* Zone */}
                <col style={{ width: '7.2%' }} />{/* Type/Conn */}
                <col style={{ width: '8.0%' }} />{/* Package/Speed */}
                <col style={{ width: '5.5%' }} />{/* Ex.Date */}
                <col style={{ width: '5.0%' }} />{/* M.Bill */}
                <col style={{ width: '6.5%' }} />{/* Received */}
                <col style={{ width: '4.0%' }} />{/* VAT */}
                <col style={{ width: '5.5%' }} />{/* Balance */}
                <col style={{ width: '4.5%' }} />{/* Advance */}
                <col style={{ width: '5.5%' }} />{/* Pay Date */}
                <col style={{ width: '5.5%' }} />{/* Server */}
                <col style={{ width: '3.8%' }} />{/* M.St */}
                <col style={{ width: '5.6%' }} />{/* B.Status */}
                <col style={{ width: '2.5%' }} />{/* Action */}
              </colgroup>
              <thead>
                <tr className="bg-[#23445f] text-white text-[9.5px] font-semibold uppercase tracking-wider [&>th]:px-1.5 [&>th]:py-2.5 [&>th]:border-r [&>th]:border-white/10 [&>th:last-child]:border-r-0">
                  <th className="!px-1 text-center">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll}
                      className="w-3.5 h-3.5 rounded cursor-pointer accent-blue-500 align-middle" />
                  </th>
                  <th className="text-center truncate">Cus. ID</th>
                  <th className="text-left truncate">
                    UserName
                    <span className="ml-0.5 opacity-60 text-[9px]">&#8597;</span>
                  </th>
                  <th className="text-left truncate">Name/Mobile</th>
                  <th className="text-left truncate">Zone</th>
                  <th className="text-left truncate">Type/Conn</th>
                  <th className="text-left truncate">Package/Speed</th>
                  <th className="text-center truncate">Ex.Date</th>
                  <th className="text-right truncate">M.Bill</th>
                  <th className="text-right truncate">Received</th>
                  <th className="text-right truncate">VAT</th>
                  <th className="text-right truncate">Balance</th>
                  <th className="text-right truncate">Advance</th>
                  <th className="text-center truncate">Pay Date</th>
                  <th className="text-left truncate">Server</th>
                  <th className="text-center truncate">M.St</th>
                  <th className="text-center truncate">B.Status</th>
                  <th className="text-center truncate">Act</th>
                </tr>
              </thead>
              <tbody>
                {mergedBills.map((bill, idx) => {
                  const cd         = clientDataCache[bill.client] || {};
                  const isSyncing  = syncingClientId === bill.client;
                  const isOnline   = cd.status === 'active' || cd.mikrotik_status === true || cd.mikrotik_status === 'active';
                  const totalDue   = bill._clientBalanceDue;
                  const totalPaid  = bill._totalPaid;
                  const advanceAmount = bill._advanceAmount;
                  const isEven              = idx % 2 === 0;
                  const checked             = selectedBills.includes(bill.id);
                  const hasPending          = bill._hasPendingPayment;
                  const exDate     = cd.expiry_date || bill.client_expiry || bill.due_date || '';
                  // expiry পর্যন্ত কত দিন বাকি (date-only তুলনা)
                  const daysLeft = (() => {
                    if (!exDate) return null;
                    const _e = new Date(exDate); if (isNaN(_e)) return null;
                    _e.setHours(0, 0, 0, 0);
                    const _t = new Date(); _t.setHours(0, 0, 0, 0);
                    return Math.round((_e - _t) / 86400000);
                  })();
                  const daysText = daysLeft === null ? '' :
                    daysLeft > 0 ? `${daysLeft} দিন বাকি` :
                    daysLeft === 0 ? 'আজ শেষ' : `${Math.abs(daysLeft)} দিন পার`;
                  const daysCls = daysLeft === null ? '' :
                    daysLeft > 5 ? 'text-emerald-600' :
                    daysLeft >= 1 ? 'text-amber-600' : 'text-red-500';
                  const serverLabel = cd.router_name || bill.client_server || bill.router_name || '—';
                  const primaryBill = bill._allBills[0];
                  return (
                    <tr key={bill.client}
                      className={`border-b border-gray-200/70 hover:bg-blue-50/40 transition-colors align-middle [&>td]:px-1.5 [&>td]:py-2 [&>td]:border-r [&>td]:border-gray-100 [&>td:last-child]:border-r-0 ${isEven ? 'bg-white' : 'bg-slate-50/60'}`}
                    >
                      {/* Checkbox */}
                      <td className="px-1 py-1.5 text-center">
                        <input type="checkbox" checked={checked} onChange={() => toggleOne(bill.id)}
                          className="w-3.5 h-3.5 rounded cursor-pointer accent-blue-500" />
                      </td>

                      {/* C.Code */}
                      <td className="px-1 py-1.5 text-center truncate">
                        <span className="font-bold text-gray-700">
                          {bill.client_customer_id || cd.customer_id || bill.client}
                          {(bill.client_is_app_user || cd.is_app_user) && (
                            <span title="অ্যাপে রেজিস্টার্ড" className="text-emerald-600 font-black text-[15px] ml-0.5 relative -top-[2px] leading-none">®</span>
                          )}
                        </span>
                      </td>

                      {/* ID / IP — ClientList style with refresh + status dot */}
                      <td className="px-1 py-1.5 overflow-hidden">
                        <p className="font-mono font-semibold text-gray-800 leading-tight truncate"
                          title={cd.ip_address || bill.client_ip || cd.username || bill.client_username || ''}>
                          {cd.username || bill.client_username || '—'}
                        </p>
                        <div className="mt-0.5 flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleSyncOnline(bill.client)}
                            disabled={isSyncing}
                            title={isSyncing ? 'Refreshing...' : 'Refresh online status'}
                            className={`inline-flex h-3.5 w-3.5 items-center justify-center transition-colors ${
                              isSyncing ? 'text-blue-400 cursor-wait' : 'text-blue-500 hover:text-blue-600'
                            }`}
                          >
                            <svg className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                          </button>
                          <span
                            title={isSyncing ? 'Checking...' : (isOnline ? 'Online' : 'Offline')}
                            className={`w-2.5 h-2.5 rounded-full inline-block shrink-0 transition-all duration-300 ${
                              isSyncing
                                ? 'bg-blue-400 ring-2 ring-blue-100 animate-pulse'
                                : isOnline
                                  ? 'bg-green-500 ring-2 ring-green-100'
                                  : 'bg-gray-400 ring-2 ring-gray-100'
                            }`}
                          />
                        </div>
                      </td>

                      {/* Name / Mobile — নামের নিচে মোবাইল */}
                      <td className="px-1 py-1.5 overflow-hidden"
                        title={`${cd.full_name || bill.client_name || ''}\n${cd.phone || bill.client_phone || ''}`}>
                        <p className="font-medium text-gray-800 leading-tight truncate">
                          {cd.full_name || bill.client_name || '—'}
                        </p>
                        <p className="text-[10px] text-gray-400 leading-tight truncate">
                          {cd.phone || bill.client_phone || '—'}
                        </p>
                      </td>

                      {/* Zone — zone-এর নিচে subzone • box */}
                      <td className="px-1 py-1.5 text-gray-700 overflow-hidden"
                        title={[cd.zone_name||bill.client_zone, cd.subzone_name||bill.client_subzone, cd.box_name||bill.client_box].filter(Boolean).join(' • ')}>
                        <p className="font-medium leading-tight truncate">{cd.zone_name || bill.client_zone || '—'}</p>
                        {(cd.subzone_name || bill.client_subzone || cd.box_name || bill.client_box) && (
                          <p className="text-[10px] text-gray-400 leading-tight truncate">
                            {[cd.subzone_name || bill.client_subzone, cd.box_name || bill.client_box].filter(Boolean).join(' • ')}
                          </p>
                        )}
                      </td>

                      {/* Type / Conn — Type • Conn */}
                      {(() => {
                        const _type = cd.client_type_name || bill.client_type_name || '';
                        const _conn = cd.protocol_name || bill.client_protocol_type || bill.client_protocol || '';
                        return (
                          <td className="px-1 py-1.5 text-gray-600 truncate"
                            title={[_type, _conn].filter(Boolean).join(' • ')}>
                            {[_type, _conn].filter(Boolean).join(' • ') || '—'}
                          </td>
                        );
                      })()}

                      {/* Package / Speed — Package • Speed */}
                      {(() => {
                        const _pkg   = cd.package_name || bill.client_package || '';
                        const _speed = cd.pppoe_profile || bill.client_speed || bill.pppoe_profile || '';
                        return (
                          <td className="px-1 py-1.5 text-gray-600 truncate"
                            title={[_pkg, _speed].filter(Boolean).join(' • ')}>
                            {[_pkg, _speed].filter(Boolean).join(' • ') || '—'}
                          </td>
                        );
                      })()}

                      {/* Ex.Date — click to open Expiry Date & Billing Remarks modal */}
                      <td className="px-1 py-1.5 text-center text-gray-600 overflow-hidden">
                        <button
                          onClick={() => openExDate(bill)}
                          title={daysText ? `Expiry: ${exDate} (${daysText})` : 'Click to update expiry date & remarks'}
                          className="group inline-flex flex-col items-center leading-tight rounded-md px-1 py-0.5 hover:bg-blue-50 transition-colors max-w-full"
                        >
                          <span className="inline-flex items-center gap-0.5 group-hover:text-blue-600">
                            <svg className="w-3 h-3 text-gray-400 group-hover:text-blue-500 shrink-0 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <span className="group-hover:underline underline-offset-2 text-[10px] truncate">{exDate || '—'}</span>
                          </span>
                          {daysText && (
                            <span className={`text-[9px] font-semibold ${daysCls}`}>{daysText}</span>
                          )}
                        </button>
                      </td>

                      {/* M.Bill — sum of all bills */}
                      <td className="px-1 py-1.5 text-right font-medium text-gray-800 truncate">
                        {bill._totalNet.toFixed(2)}
                      </td>

                      {/* Received — sum + method badge + pending hand icon */}
                      <td className="px-1 py-1.5 text-right overflow-hidden">
                        {totalPaid > 0 ? (
                          <div className="flex flex-col items-end gap-0.5">
                            {/* Amount row + pending icon */}
                            <div className="inline-flex items-center gap-1">
                              <span className="text-green-600 font-medium truncate">{totalPaid.toFixed(2)}</span>
                              {hasPending && isAdmin && (
                                <div className="relative group/hand">
                                  <button
                                    onClick={() => navigate('/billing/daily-collection')}
                                    className="flex h-[20px] w-[20px] items-center justify-center cursor-pointer animate-pulse hover:scale-110 transition-transform"
                                    title="Pending Approval — ক্লিক করে Daily Collection-এ যান"
                                  >
                                    <svg viewBox="0 0 64 64" className="w-[20px] h-[20px]" xmlns="http://www.w3.org/2000/svg">
                                      <rect x="12" y="8" width="40" height="22" rx="3" ry="3" fill="#4ade80"/>
                                      <rect x="12" y="8" width="40" height="22" rx="3" ry="3" fill="none" stroke="#16a34a" strokeWidth="1.5"/>
                                      <circle cx="32" cy="19" r="6.5" fill="#16a34a"/>
                                      <circle cx="32" cy="19" r="4.2" fill="#4ade80"/>
                                      <text x="32" y="22.5" textAnchor="middle" fontSize="6" fontWeight="bold" fill="#16a34a">$</text>
                                      <circle cx="17" cy="19" r="2.5" fill="#16a34a" opacity="0.45"/>
                                      <circle cx="47" cy="19" r="2.5" fill="#16a34a" opacity="0.45"/>
                                      <path d="M8 42 C8 37.5 11.5 35 16 35 H29.5 C31.5 35 33 36.4 33 38.3 C33 40.2 31.5 41.5 29.5 41.5 H22.5 C21.7 41.5 21 42.2 21 43 C21 43.8 21.7 44.5 22.5 44.5 H38.5 C42 44.5 45.4 43.4 48 41.3 L53 37.4 C54.5 36.2 56.6 36.3 57.7 37.7 C58.9 39.2 58.7 41.3 57.2 42.5 L50.2 48 C46.7 50.7 42.5 52.2 38 52.2 H16.5 C11.7 52.2 8 48.3 8 43.5 Z" fill="#1e1e1e"/>
                                      <path d="M8 41.8 H12.5 C13.9 41.8 15 43 15 44.5 V51.2 H11.8 C9.7 51.2 8 49.5 8 47.4 Z" fill="#111827"/>
                                    </svg>
                                  </button>
                                  <div className="pointer-events-none absolute bottom-full right-0 mb-2 z-50 hidden group-hover/hand:block">
                                    <div className="whitespace-nowrap rounded-lg bg-[#1c2333] px-3 py-2 text-[11px] font-medium text-white shadow-xl border border-[#2a3347]">
                                      <p className="font-bold text-amber-400">⏳ Pending Approval</p>
                                      <p className="mt-0.5 text-gray-300 font-normal">Collector/Worker রিসিভ করেছে</p>
                                      <p className="text-gray-400 font-normal text-[10px]">ক্লিক করুন → Daily Collection এ Approve করুন</p>
                                    </div>
                                    <span className="absolute top-full right-3 border-4 border-transparent border-t-[#1c2333]" />
                                  </div>
                                </div>
                              )}
                            </div>
                            {/* Payment method badge */}
                            {bill._lastPaymentMethod && (
                              <PayMethodBadge method={bill._lastPaymentMethod} />
                            )}
                          </div>
                        ) : <span className="text-gray-300">—</span>}
                      </td>

                      {/* VAT */}
                      <td className="px-1 py-1.5 text-right text-gray-600 truncate">
                        {Number(bill.vat_amount || 0).toFixed(2)}
                      </td>

                      {/* BalanceDue — sum of ALL bills' due */}
                      <td className="px-1 py-1.5 text-right truncate">
                        {totalDue > 0 ? (
                          <span className="text-red-600 font-semibold">{totalDue.toFixed(2)}</span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>

                      {/* Advance */}
                      <td className="px-1 py-1.5 text-right text-gray-600 truncate">
                        {advanceAmount > 0 ? advanceAmount.toFixed(2) : ''}
                      </td>

                      {/* PaymentDate */}
                      <td className="px-1 py-1.5 text-center text-gray-500 truncate text-[10px]">
                        {bill.last_payment_date || ''}
                      </td>

                      {/* Server */}
                      <td className="px-1 py-1.5 text-gray-600 text-[10px] truncate" title={serverLabel}>
                        {serverLabel}
                      </td>

                      {/* M.Status — from clientDataCache */}
                      <td className="px-1 py-1.5 text-center">
                        <MStatusToggle active={isOnline} clientId={bill.client} />
                      </td>

                      {/* B.Status */}
                      <td className="px-1 py-1.5 text-center overflow-hidden">
                        {!primaryBill.id ? (
                          <div className="flex items-center justify-center gap-0.5">
                            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-200 text-gray-500">No Bill</span>
                            <button
                              onClick={() => openPay(primaryBill)}
                              className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-500 text-white hover:bg-purple-600 transition-colors"
                            >Adv</button>
                          </div>
                        ) : bill.status === 'paid' ? (
                          <button
                            onClick={() => openPay(primaryBill)}
                            className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-500 text-white hover:bg-green-600 transition-colors cursor-pointer"
                            title="Advance payment নিতে ক্লিক করুন"
                          >Paid</button>
                        ) : bill.status === 'waived' ? (
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-400 text-white">Waived</span>
                        ) : (
                          <div className="flex items-center justify-center gap-0.5">
                            <button
                              onClick={() => openPay(primaryBill)}
                              className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-gray-500 text-white hover:bg-gray-600 transition-colors"
                            >Pay</button>
                            <span className={`inline-block px-1 py-0.5 rounded text-[9px] font-bold text-white ${bill.status === 'partial' ? 'bg-yellow-500' : 'bg-red-500'}`}>
                              {bill.status === 'partial' ? 'Part' : 'Due'}
                            </span>
                          </div>
                        )}
                      </td>

                      {/* Action */}
                      <td className="px-1 py-1.5 text-center">
                        <BillActionsMenu
                          bill={primaryBill}
                          hasBill={!!primaryBill.id}
                          isAdmin={isAdmin}
                          onProfile={() => navigate(`/clients/${primaryBill.client}/profile`)}
                          onEdit={() => openEdit(primaryBill)}
                          onPay={() => openPay(primaryBill)}
                          onHistory={() => openHistory(primaryBill)}
                          onWaive={() => openWaive(primaryBill)}
                          onDownload={() => downloadInvoice(primaryBill.id, api)}
                          onStatement={() => downloadStatement(bill.client, api)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {bills.length === 0 && (
              <div className="text-center py-16 text-gray-400 text-sm">No bills found.</div>
            )}
          </div>
          </>
        )}

        {/* Pagination */}
        <div className="flex justify-between items-center px-4 py-3 border-t border-gray-100 text-xs text-gray-500">
          <span>
            Showing {bills.length > 0 ? (page - 1) * perPage + 1 : 0}–{(page - 1) * perPage + bills.length} of {count} entries
          </span>
          <div className="flex gap-1 items-center">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors">
              ← Prev
            </button>
            {[...Array(Math.min(5, Math.ceil(count / perPage)))].map((_, i) => {
              const pg = i + 1;
              return (
                <button key={pg} onClick={() => setPage(pg)}
                  className={`w-8 h-8 rounded-lg border text-xs font-medium transition-colors ${page === pg ? 'bg-[#23445f] text-white border-[#23445f]' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  {pg}
                </button>
              );
            })}
            <button onClick={() => setPage(p => p + 1)} disabled={bills.length < perPage}
              className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors">
              Next →
            </button>
          </div>
        </div>
      </div>

      {/* ── Edit Modal ── */}
      {editBill && (() => {
        // Paid/Partial বিল = financially sensitive → reason বাধ্যতামূলক + Admin/Superadmin-only
        const editSensitive = ['paid', 'partial'].includes(editBill.status);
        const editLocked    = editSensitive && !isAdmin;
        const reasonMissing = editSensitive && !editForm.reason?.trim();
        return (
        <Modal title={`Edit Bill — ${editBill.client_name} (${editBill.bill_month})`} onClose={() => setEditBill(null)}>
          <div className="space-y-3">
            {editSensitive && (
              <div className={`rounded-lg border px-3 py-2 text-xs font-medium ${
                editLocked ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}>
                {editLocked
                  ? '🔒 এই বিলে টাকা পরিশোধ হয়েছে — edit শুধু Admin/Superadmin করতে পারবে।'
                  : '⚠️ এই বিলে টাকা পরিশোধ হয়েছে — পরিবর্তনের কারণ (reason) দেওয়া বাধ্যতামূলক।'}
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Amount (৳)</label>
                <input className="input" type="number" min="0" step="0.01"
                  value={editForm.amount}
                  onChange={e => handleEditChange('amount', e.target.value)} />
              </div>
              <div>
                <label className="label">Discount (৳)</label>
                <input className="input" type="number" min="0" step="0.01"
                  value={editForm.discount}
                  onChange={e => handleEditChange('discount', e.target.value)} />
              </div>
            </div>

            <div className="bg-gray-50 rounded-lg px-4 py-3 flex justify-between items-center">
              <span className="text-sm text-gray-600">Net Amount</span>
              <span className="text-lg font-bold text-primary-700">{Number(editForm.net_amount || 0).toLocaleString()}</span>
            </div>

            <div>
              <label className="label">Due Date</label>
              <input className="input" type="date"
                value={editForm.due_date}
                onChange={e => handleEditChange('due_date', e.target.value)} />
            </div>

            <div>
              <label className="label">Status</label>
              <select className="input" value={editForm.status}
                onChange={e => handleEditChange('status', e.target.value)}>
                <option value="unpaid">Unpaid</option>
                <option value="partial">Partial</option>
                <option value="paid">Paid</option>
                {/* "Waived" সরানো হয়েছে — waive করতে row-এর ⋮ → Waive বাটন ব্যবহার করুন
                    (perform_update status override করে, তাই এখান থেকে waive কাজ করত না) */}
              </select>
            </div>

            {/* পরিবর্তনের কারণ — paid/partial বিলে বাধ্যতামূলক */}
            <div>
              <label className="label">
                Reason {editSensitive ? <span className="text-red-500">*</span> : <span className="text-gray-400 font-normal">(optional)</span>}
              </label>
              <textarea className="input" rows={2}
                value={editForm.reason || ''}
                disabled={editLocked}
                onChange={e => setEditForm(f => ({ ...f, reason: e.target.value }))}
                placeholder={editSensitive ? 'কেন এই বিল পরিবর্তন করা হচ্ছে তা লিখুন...' : 'ঐচ্ছিক মন্তব্য'} />
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-5">
            <button onClick={() => setEditBill(null)} className="btn-secondary">Cancel</button>
            <button onClick={handleEditSave} disabled={saving || editLocked || reasonMissing}
              className="btn-primary disabled:opacity-50">
              {saving ? 'Saving...' : '✓ Save Changes'}
            </button>
          </div>
        </Modal>
        );
      })()}

      {/* ── Waive Modal — বকেয়া মাফ (Admin/Superadmin) ── */}
      {waiveBill && (
        <Modal title={`Waive Bill — ${waiveBill.client_name} (${waiveBill.bill_month})`} onClose={() => setWaiveBill(null)}>
          <div className="space-y-3">
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
              এই বিলের বকেয়া <span className="font-bold">৳ {Number(waiveBill.due_amount || 0).toLocaleString()}</span> মাফ
              (waive) করা হবে। বিল ও পেমেন্ট রেকর্ড মুছবে না — শুধু due শূন্য হয়ে status
              <span className="font-semibold"> Waived</span> হবে। এটি ফেরানো যায় না।
            </div>
            <div>
              <label className="label">Reason <span className="text-gray-400 font-normal">(optional, log-এ থাকবে)</span></label>
              <textarea className="input" rows={2}
                value={waiveReason}
                onChange={e => setWaiveReason(e.target.value)}
                placeholder="কেন মাফ করা হচ্ছে (যেমন: ভুলে তৈরি বিল, goodwill ইত্যাদি)..." />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-5">
            <button onClick={() => setWaiveBill(null)} className="btn-secondary">Cancel</button>
            <button onClick={handleWaive} disabled={waiving}
              className="btn-primary !bg-amber-600 hover:!bg-amber-700 disabled:opacity-50">
              {waiving ? 'Waiving...' : '✓ Confirm Waive'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Bill Receive Modal — Modern Design ── */}
      {payBill && (() => {
        const money = v => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
        const userLabel = u => u ? ((u.get_full_name || u.full_name || '').trim() || u.username || '') : '';

        const billAmount      = Number(payBill.amount || 0);
        const alreadyPaid     = Number(payBill.paid_amount || 0);
        const newDiscount     = Number(payForm.discount || 0);
        const newNetAmt       = Math.max(billAmount - newDiscount, 0);
        // এই বিলের নিজের বর্তমান due (amount − বর্তমান discount − paid)।
        // ⚠️ payBill.due_amount ব্যবহার করা যাবে না — per-client endpoint-এ ওটা
        // ক্লায়েন্টের সব বিলের মোট due (client_balance_due), এক বিলের নয়।
        const oldThisBillDue  = Math.max(billAmount - Number(payBill.discount || 0) - alreadyPaid, 0);
        // এই বিলের নতুন due (discount পরিবর্তনের পর)
        const newThisBillDue  = Math.max(newNetAmt - alreadyPaid, 0);
        // মোট client balance due: সব বিলের যোগফল, discount পরিবর্তনের জন্য adjust করা
        const totalClientDue  = Math.max(
          Number(payBill._clientBalanceDue ?? payBill.client_balance_due ?? payBill.due_amount ?? 0)
          - oldThisBillDue + newThisBillDue, 0
        );
        const received        = Number(payForm.amount || 0);
        const balance         = Math.max(totalClientDue - received, 0);
        const advanceToAdd    = Math.max(received - totalClientDue, 0);

        const statusBadge = {
          active:    'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200',
          inactive:  'bg-gray-100 text-gray-500 ring-1 ring-gray-200',
          left:      'bg-red-100 text-red-600 ring-1 ring-red-200',
          suspended: 'bg-orange-100 text-orange-600 ring-1 ring-orange-200',
        }[payBill.client_status?.toLowerCase()] || 'bg-gray-100 text-gray-500 ring-1 ring-gray-200';

        const readCls = 'flex h-9 w-full items-center overflow-hidden truncate rounded-lg border border-gray-200 bg-[#f4f7fa] px-3 text-sm text-gray-700';
        const lbl     = 'mb-1 block text-[10px] font-bold uppercase tracking-wider text-[#5a7a90]';
        const editCls = 'h-9 w-full rounded-lg border border-[#b8d0e0] bg-white px-3 text-sm text-gray-800 outline-none transition focus:border-[#1d435d] focus:ring-2 focus:ring-[#1d435d]/15';

        return (
          <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 p-0 md:px-3 md:py-4 backdrop-blur-sm">
            <div className="flex w-full md:w-[800px] md:max-w-full max-h-[90vh] flex-col overflow-hidden rounded-t-2xl md:rounded-2xl bg-white shadow-2xl">

              {/* ── Header ── */}
              <div className="shrink-0 bg-gradient-to-r from-[#1d435d] to-[#245f84] px-6 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-2xl select-none">💳</div>
                    <div className="min-w-0">
                      <p className="text-lg font-bold leading-tight text-white">Bill Receive</p>
                      <p className="mt-0.5 truncate text-xs text-blue-200">
                        {payBill.bill_month} &nbsp;·&nbsp; {payBill.client_name || payBill.client_username}
                      </p>
                    </div>
                  </div>
                  <button onClick={() => setPayBill(null)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xl text-white/60 transition hover:bg-white/25 hover:text-white">
                    ×
                  </button>
                </div>
              </div>

              {/* ── Body ── */}
              <div className="flex-1 space-y-4 overflow-y-auto p-5">

                {/* Client Info Card */}
                <div className="rounded-xl border border-[#d0e4f0] bg-[#f0f6fa] p-4">
                  <p className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#1d435d]">
                    <span className="h-px flex-1 bg-[#1d435d]/20" />Client Information<span className="h-px flex-1 bg-[#1d435d]/20" />
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                    <div>
                      <label className={lbl}>Username</label>
                      <div className={readCls}>{payBill.client_username || payBill.client_customer_id || '—'}</div>
                    </div>
                    <div>
                      <label className={lbl}>Mobile</label>
                      <div className={readCls}>{payBill.client_phone || '—'}</div>
                    </div>
                    <div>
                      <label className={lbl}>Bill Date</label>
                      <div className={readCls}>{payBill.client_bill_date || '—'}</div>
                    </div>
                    <div>
                      <label className={lbl}>Status</label>
                      <div>
                        <span className={`inline-flex items-center rounded-full px-3 py-0.5 text-xs font-semibold capitalize ${statusBadge}`}>
                          {payBill.client_status || '—'}
                        </span>
                      </div>
                    </div>
                    <div>
                      <label className={lbl}>Zone</label>
                      <div className={readCls}>{payBill.client_zone || '—'}</div>
                    </div>
                    <div className="col-span-2">
                      <label className={lbl}>Address</label>
                      <div className={readCls} title={payBill.client_address || ''}>{payBill.client_address || '—'}</div>
                    </div>
                    <div>
                      <label className={lbl}>Package</label>
                      <div className={readCls}>{payBill.client_package || '—'}</div>
                    </div>
                    <div>
                      <label className={lbl}>Received From</label>
                      <div className={`${readCls} font-medium`}>{payBill.client_name || '—'}</div>
                    </div>
                    <div>
                      <label className={lbl}>Monthly Bill (৳)</label>
                      <div className={`${readCls} font-semibold text-[#1d435d]`}>৳ {money(payBill.client_monthly_bill)}</div>
                    </div>
                    <div>
                      <label className={lbl}>Already Paid (৳) <span className="normal-case font-normal text-gray-400">this bill</span></label>
                      <div className={`${readCls} font-semibold text-emerald-600`}>৳ {money(payBill.paid_amount)}</div>
                    </div>
                    <div>
                      <label className={lbl}>Total Balance Due (৳) <span className="normal-case font-normal text-gray-400">all bills</span></label>
                      <div className={`${readCls} font-bold text-red-600`}>৳ {money(payBill._clientBalanceDue ?? payBill.client_balance_due ?? payBill.due_amount)}</div>
                    </div>
                  </div>
                </div>

                {/* Payment Details Card */}
                <div className="overflow-hidden rounded-xl border border-gray-200">
                  <div className="bg-[#1d435d] px-4 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/90">Payment Details</p>
                  </div>
                  <div className="grid grid-cols-1 gap-x-6 gap-y-4 p-4 sm:grid-cols-2">

                    {/* Received By + Payment Method */}
                    <div>
                      <label className={lbl}>Received By <span className="text-red-500">*</span></label>
                      <select className={editCls} value={payForm.received_by}
                        onChange={e => setPayForm(f => ({ ...f, received_by: e.target.value }))}>
                        <option value="">— কে গ্রহণ করেছে —</option>
                        {payUsers.map(item => (
                          <option
                            key={(item._type === 'user' ? 'u' : 'e') + item.id}
                            value={item._type === 'user' ? String(item.id) : (item.user ? String(item.user) : `emp:${item.id}`)}
                          >
                            {item.full_name}{item.designation ? ` — ${item.designation}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={lbl}>Payment Method</label>
                      <select className={editCls} value={payForm.payment_method}
                        onChange={e => setPayForm(f => ({ ...f, payment_method: e.target.value }))}>
                        <option value="cash">💵 Cash</option>
                        <option value="bkash">📱 bKash</option>
                        <option value="nagad">📱 Nagad</option>
                        <option value="rocket">📱 Rocket</option>
                        <option value="bank">🏦 Bank Transfer</option>
                        <option value="other">🔖 Other</option>
                      </select>
                    </div>

                    {/* Bill Month + Bill Amount */}
                    {payBill.id && <>
                      <div>
                        <label className={lbl}>Bill Month</label>
                        <div className={readCls}>{payBill.bill_month}</div>
                      </div>
                      <div>
                        <label className={lbl}>Bill Amount (৳)</label>
                        <div className={`${readCls} font-semibold`}>৳ {money(billAmount)}</div>
                      </div>
                      <div>
                        <label className={lbl}>
                          Discount (৳)
                          <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold normal-case tracking-normal text-amber-700">editable</span>
                        </label>
                        <input className={editCls} type="number" min="0" max={billAmount} step="0.01"
                          value={payForm.discount}
                          onChange={e => {
                            const d = e.target.value;
                            const discountVal = Math.max(Number(d || 0), 0);
                            const netVal = Math.max(billAmount - discountVal, 0);
                            const newThisDue = Math.max(netVal - alreadyPaid, 0);
                            const newTotalDue = Math.max(
                              Number(payBill._clientBalanceDue ?? payBill.client_balance_due ?? payBill.due_amount ?? 0)
                              - oldThisBillDue + newThisDue, 0
                            );
                            setPayForm(f => ({ ...f, discount: d, amount: String(newTotalDue) }));
                          }}
                        />
                      </div>
                      <div>
                        <label className={lbl}>After Discount (৳)</label>
                        <div className={`${readCls} font-semibold text-[#1d435d]`}>৳ {money(newNetAmt)}</div>
                      </div>
                    </>}

                    {/* Received Amount + Transaction No */}
                    <div>
                      <label className={lbl}>
                        Received Amount (৳)
                        <span className="ml-1 text-red-500">*</span>
                      </label>
                      <input
                        className="h-11 w-full rounded-lg border-2 border-[#1d435d]/40 bg-white px-3 text-lg font-bold text-[#1d435d] outline-none transition focus:border-[#1d435d] focus:ring-2 focus:ring-[#1d435d]/15"
                        type="number" min="0" step="0.01"
                        value={payForm.amount}
                        onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className={lbl}>Transaction / Receipt No.</label>
                      <input className={editCls} value={payForm.transaction_id}
                        onChange={e => setPayForm(f => ({ ...f, transaction_id: e.target.value }))}
                        placeholder="TXN-XXXXXXXX" />
                    </div>

                    {/* Balance Due + Remarks */}
                    <div>
                      <label className={lbl}>
                        {advanceToAdd > 0 ? 'Advance Balance Added (৳)' : 'Balance Due (৳)'}
                        {advanceToAdd === 0 && balance === 0 && (
                          <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold normal-case tracking-normal text-emerald-700">Cleared</span>
                        )}
                      </label>
                      {advanceToAdd > 0 ? (
                        <div className="flex h-11 w-full items-center rounded-lg border-2 border-blue-200 bg-blue-50 px-3 text-lg font-bold text-blue-600">
                          ৳ {money(advanceToAdd)}
                          <span className="ml-2 text-xs font-normal text-blue-400">→ advance_balance</span>
                        </div>
                      ) : (
                        <div className={`flex h-11 w-full items-center rounded-lg border-2 px-3 text-lg font-bold transition ${
                          balance > 0
                            ? 'border-red-200 bg-red-50 text-red-600'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-600'
                        }`}>
                          ৳ {money(balance)}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className={lbl}>Remarks / Note</label>
                      <input className={editCls} value={payForm.notes}
                        onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))}
                        placeholder="Received in hand" />
                    </div>

                  </div>
                </div>
              </div>

              {/* ── Footer ── */}
              <div className="shrink-0 flex items-center gap-3 border-t border-gray-200 bg-gray-50 px-6 py-3">
                <button onClick={() => setPayBill(null)}
                  className="h-10 flex-1 rounded-xl border-2 border-gray-300 text-sm font-semibold text-gray-600 transition hover:border-red-400 hover:bg-red-50 hover:text-red-600">
                  Cancel
                </button>
                <button onClick={handlePay} disabled={paying}
                  className="h-10 flex-1 rounded-xl bg-[#1d435d] text-sm font-bold text-white shadow-sm transition hover:bg-[#245f84] disabled:opacity-50">
                  {paying ? 'সংরক্ষণ হচ্ছে...' : '✓ Submit Payment'}
                </button>
              </div>

            </div>
          </div>
        );
      })()}


      {/* ── Expiry Date & Billing Remarks Modal ── */}
      {exDateModal && (() => {
        const cd      = clientDataCache[exDateModal.client] || {};
        const lbl     = 'mb-1 block text-[10px] font-bold uppercase tracking-wider text-[#5a7a90]';
        const readCls = 'flex h-9 w-full items-center overflow-hidden truncate rounded-lg border border-gray-200 bg-[#f4f7fa] px-3 text-sm text-gray-700';
        const editCls = 'h-9 w-full rounded-lg border border-[#b8d0e0] bg-white px-3 text-sm text-gray-800 outline-none transition focus:border-[#1c2333] focus:ring-2 focus:ring-[#1c2333]/15';
        return (
          <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 p-0 md:px-3 md:py-4 backdrop-blur-sm">
            <div className="w-full md:w-[500px] md:max-w-full max-h-[90vh] flex flex-col overflow-hidden rounded-t-2xl md:rounded-2xl bg-white shadow-2xl">

              {/* Header */}
              <div className="shrink-0 bg-gradient-to-r from-[#1c2333] to-[#2a3347] px-6 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-2xl select-none">📅</div>
                    <div className="min-w-0">
                      <p className="text-base font-bold leading-tight text-white">Expiry Date &amp; Billing Remarks Info</p>
                      <p className="mt-0.5 truncate text-xs text-blue-200">
                        {exDateModal.client_name || cd.full_name || exDateModal.client_username || '—'}
                      </p>
                    </div>
                  </div>
                  <button onClick={() => setExDateModal(null)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xl text-white/60 transition hover:bg-white/25 hover:text-white">
                    ×
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 space-y-4 overflow-y-auto p-5">

                {/* CLIENT CODE + USER ID/IP */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={lbl}>CLIENT CODE</label>
                    <div className={readCls}>
                      {exDateModal.client_customer_id || cd.customer_id || '—'}
                    </div>
                  </div>
                  <div>
                    <label className={lbl}>USER ID / IP</label>
                    <div className={`${readCls} font-mono`}>
                      {exDateModal.client_username || cd.username || '—'}
                    </div>
                  </div>
                </div>

                {/* REMARKS / NOTE / COMMENTS */}
                <div>
                  <label className={lbl}>REMARKS / NOTE / COMMENTS</label>
                  <textarea
                    rows={3}
                    className="w-full rounded-lg border border-[#b8d0e0] bg-white px-3 py-2 text-sm text-gray-800 outline-none transition focus:border-[#1c2333] focus:ring-2 focus:ring-[#1c2333]/15 resize-none"
                    placeholder="Enter remarks or notes..."
                    value={exDateForm.notes}
                    onChange={e => setExDateForm(f => ({ ...f, notes: e.target.value }))}
                  />
                </div>

                {/* BILLING EXPIRY DATE */}
                <div>
                  <label className={lbl}>BILLING EXPIRY DATE</label>
                  <div className="relative">
                    <input
                      type="date"
                      className={`${editCls} pr-10`}
                      value={exDateForm.expiry_date}
                      onChange={e => setExDateForm(f => ({ ...f, expiry_date: e.target.value }))}
                    />
                    <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                </div>

                {/* IS VIP CLIENT? */}
                <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                  <input
                    type="checkbox"
                    id="exdate-vip-check"
                    checked={exDateForm.is_vip}
                    onChange={e => setExDateForm(f => ({ ...f, is_vip: e.target.checked }))}
                    className="w-4 h-4 rounded accent-amber-500 cursor-pointer"
                  />
                  <label htmlFor="exdate-vip-check" className="flex-1 cursor-pointer select-none">
                    <span className="text-sm font-semibold text-gray-700">IS VIP CLIENT?</span>
                    <span className="ml-2 text-xs text-gray-400">Click to Set</span>
                  </label>
                  {exDateForm.is_vip && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                      ⭐ VIP
                    </span>
                  )}
                </div>

              </div>

              {/* Footer */}
              <div className="shrink-0 flex items-center gap-3 border-t border-gray-200 bg-gray-50 px-6 py-3">
                <button onClick={() => setExDateModal(null)}
                  className="h-10 flex-1 rounded-xl border-2 border-red-300 text-sm font-semibold text-red-600 transition hover:bg-red-50 hover:border-red-400">
                  Cancel
                </button>
                <button onClick={handleExDateSave} disabled={exDateSaving}
                  className="h-10 flex-1 rounded-xl bg-[#173d59] border-2 border-[#173d59] text-sm font-bold text-white shadow-sm transition hover:bg-[#1c2f44] disabled:opacity-50">
                  {exDateSaving ? 'Saving...' : '✓ Submit'}
                </button>
              </div>

            </div>
          </div>
        );
      })()}

      {/* ── Payment History Modal ── */}
      {histBill && (
        <Modal title={`Payment History — ${histBill.client_name} (${histBill.bill_month})`} onClose={() => setHistBill(null)} wide>
          {histLoad ? (
            <div className="text-center py-8 text-gray-400 text-sm">Loading...</div>
          ) : histPays.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">No payment records found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2 text-left">Method</th>
                    <th className="px-3 py-2 text-left">Transaction</th>
                    <th className="px-3 py-2 text-left">Received By</th>
                    <th className="px-3 py-2 text-left">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {histPays.map(p => (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-600">{new Date(p.payment_date).toLocaleString('en-US')}</td>
                      <td className="px-3 py-2 text-right font-medium text-green-600">{Number(p.amount || 0).toLocaleString()}</td>
                      <td className="px-3 py-2 text-gray-700">{METHODS.find(m => m.value === p.payment_method)?.label || p.payment_method}</td>
                      <td className="px-3 py-2 text-gray-500 font-mono text-xs">{p.transaction_id || <span className="text-gray-300">—</span>}</td>
                      <td className="px-3 py-2 text-gray-600">{p.received_by_name || '—'}</td>
                      <td className="px-3 py-2 text-gray-500 max-w-xs truncate">{p.notes || <span className="text-gray-300">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex justify-end mt-4">
            <button onClick={() => setHistBill(null)} className="btn-secondary">Close</button>
          </div>
        </Modal>
      )}

    </div>
  );
}
