

const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const ids = process.argv.slice(2);

if (!ids.length) {
  console.log('Usage: node scripts/make-qr.js ID [ID ...]');
  process.exit(1);
}
const bad = ids.filter(id => !/^[A-Za-z0-9_-]{1,64}$/.test(id));
if (bad.length) {
  console.error('Invalid id(s): ' + bad.join(', ') + ' (use letters, digits, - and _ only)');
  process.exit(1);
}

const outDir = path.join(__dirname, '..', 'qr-codes');
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  for (const id of ids) {
    const url = `${BASE_URL}/?start=${encodeURIComponent(id)}`;
    await QRCode.toFile(path.join(outDir, id + '.png'), url, { width: 600, margin: 4, errorCorrectionLevel: 'M' });
    console.log(id + ' -> ' + url);
  }
})();
