'use strict';

const XLSX = require('xlsx');
const { Parser } = require('json2csv');

function toCSV(data) {
  if (!data || data.length === 0) return '';
  try {
    const parser = new Parser({ fields: Object.keys(data[0]) });
    return parser.parse(data);
  } catch (e) {
    return '';
  }
}

function toJSON(data) {
  return JSON.stringify(data, null, 2);
}

function toXLSX(data) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(
    data.map(row => {
      const flat = {};
      for (const [k, v] of Object.entries(row)) {
        flat[k] = Array.isArray(v) ? JSON.stringify(v) : v;
      }
      return flat;
    })
  );
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function toHTML(data) {
  if (!data || data.length === 0) return '<p>No data</p>';
  const keys = Object.keys(data[0]);
  const header = keys.map(k => `<th>${k}</th>`).join('');
  const rows = data.map(row =>
    `<tr>${keys.map(k => `<td>${Array.isArray(row[k]) ? JSON.stringify(row[k]) : (row[k] ?? '')}</td>`).join('')}</tr>`
  ).join('\n');
  return `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:monospace;font-size:12px">
  <thead><tr style="background:#111;color:#fff">${header}</tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

module.exports = { toCSV, toJSON, toXLSX, toHTML };
