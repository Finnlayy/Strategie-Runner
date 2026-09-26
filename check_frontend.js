import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  page.on('console', msg => {
    console.log(`[${msg.type().toUpperCase()}] ${msg.text()}`);
    const loc = msg.location();
    if (loc && loc.url) {
       console.log(`    at ${loc.url}:${loc.lineNumber}:${loc.columnNumber}`);
    }
  });
  
  page.on('pageerror', error => console.log('[PAGE ERROR]', error.message));

  page.on('response', response => {
    if (!response.ok()) {
      console.log(`[HTTP ${response.status()}] ${response.url()}`);
    }
  });

  console.log('Navigating to http://localhost:3000...');
  try {
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 15000 });
  } catch (err) {
    console.log('Navigation ended:', err.message);
  }

  await new Promise(r => setTimeout(r, 2000));
  await browser.close();
})();
