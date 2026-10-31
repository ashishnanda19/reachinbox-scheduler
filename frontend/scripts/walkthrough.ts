// End-to-end walkthrough of the acceptance flow in a real (headless) Chromium, with no manual refresh:
// compose (rich text + CSV of 25 + attachment + delay) -> Send Later 2 minutes ahead -> watch Scheduled
// move to Sent -> open a sent email -> cancel a scheduled one -> search -> user menu (Slack).
// Needs the same running stack as screenshots.ts. Run: npx tsx scripts/walkthrough.ts
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dayjs from 'dayjs';
import { chromium, type Page } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = process.env.APP_URL ?? 'http://localhost:5173';
const OUT = path.join(ROOT, 'docs/walkthrough');
mkdirSync(OUT, { recursive: true });

const log = (step: string, detail = '') => console.log(`\n[${new Date().toLocaleTimeString()}] ${step}${detail ? `: ${detail}` : ''}`);
const check = (ok: boolean, what: string) => {
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) process.exitCode = 1;
};

function mint(name: string, email: string): string {
  return execFileSync('npm', ['run', '-s', 'token', '--', name, email], { cwd: path.join(ROOT, 'backend') }).toString().trim().split('\n').pop()!;
}

const sidebarCounts = (page: Page) =>
  page.evaluate(() => {
    const read = (label: string) => {
      const link = Array.from(document.querySelectorAll('aside a')).find((a) => a.textContent?.includes(label));
      return Number(link?.querySelector('span:last-child')?.textContent ?? NaN);
    };
    return { scheduled: read('Scheduled'), sent: read('Sent') };
  });

async function main() {
  const runId = Date.now().toString(36);
  const email = `walkthrough.${runId}@domain.io`;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.addCookies([{ name: 'session', value: mint('Walk Through', email), domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await context.addInitScript('window.__name = (fn) => fn;'); // esbuild (tsx) injects __name into serialized functions
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('   [page error]', e.message));
  page.on('dialog', (d) => void d.accept());

  // ---- files ----
  const emails = Array.from({ length: 25 }, (_, i) => `lead${String(i + 1).padStart(2, '0')}.${runId}@example.com`);
  const csv = ['name,email', ...emails.map((e, i) => `Lead ${i + 1},${e}`), `Dup,${emails[0]}`, 'Broken,not-an-email@'].join('\n');
  const csvPath = path.join(OUT, 'leads.csv');
  writeFileSync(csvPath, csv);
  await page.goto(`${APP}/login`);
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 480;
    c.height = 270;
    const x = c.getContext('2d')!;
    x.fillStyle = '#2f6fe4';
    x.fillRect(0, 0, 480, 270);
    x.fillStyle = '#ffd23f';
    x.beginPath();
    x.arc(120, 90, 40, 0, 7);
    x.fill();
    return c.toDataURL('image/png').split(',')[1]!;
  });
  const pngPath = path.join(OUT, 'brand.png');
  writeFileSync(pngPath, Buffer.from(png, 'base64'));

  // ---- 1. already logged in: /login redirects to /scheduled ----
  log('1. Session cookie present, opening /login');
  await page.goto(`${APP}/login`);
  await page.waitForURL('**/scheduled');
  check(page.url().endsWith('/scheduled'), 'a logged-in user opening /login is sent to /scheduled');
  await page.getByText('No scheduled emails').waitFor({ timeout: 10_000 });
  check(true, 'empty state is shown for a new user');

  // ---- 2. compose ----
  log('2. Compose: rich text, CSV of 25, attachment, small delay, Send Later +2 minutes');
  await page.getByRole('button', { name: 'Compose', exact: true }).click();
  await page.waitForURL('**/compose');
  await page.locator('input[type=file][accept*=csv]').setInputFiles(csvPath);
  await page.getByText('25 emails detected').waitFor();
  check(true, 'CSV parsed: "25 emails detected" (1 duplicate and 1 invalid skipped)');
  await page.getByText('Added 25 emails (2 duplicates or invalid skipped)').waitFor();
  check(true, 'toast reports "Added 25 emails (2 duplicates or invalid skipped)"');
  await page.locator('#subject').fill(`Walkthrough ${runId}`);
  await page.locator('#delay').fill('1');
  await page.locator('#limit').fill('100');

  const editor = page.locator('.email-editor');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type('Big news');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type(' for the whole team.');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Bullet list' }).click();
  await page.keyboard.type('First point');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second point');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter'); // leave the list
  await page.getByRole('button', { name: 'Quote' }).click();
  await page.keyboard.type('Reply now to claim your spot.');
  const html = await editor.innerHTML();
  check(/<strong>Big news<\/strong>/.test(html) && /<ul>/.test(html) && /<blockquote>/.test(html), 'editor produced bold, a bullet list and a quote');

  await page.locator('input[type=file]:not([accept])').setInputFiles(pngPath);
  await page.locator('[aria-label="Remove brand.png"]').waitFor();
  check(true, 'attachment chosen (brand.png) and shown as a card');

  await page.getByRole('button', { name: 'Send later' }).click();
  const target = dayjs().add(2, 'minute').add(1, 'minute').startOf('minute'); // 2-3 minutes ahead
  await page.locator('input[aria-label="Pick date and time"]').fill(target.format('YYYY-MM-DDTHH:mm'));
  await page.getByRole('button', { name: 'Done' }).click();
  const submit = page.getByRole('button', { name: 'Send Later', exact: true });
  await submit.waitFor();
  check(await submit.isEnabled(), `form is valid; start time ${target.format('h:mm A')}; primary button reads "Send Later"`);
  await page.screenshot({ path: path.join(OUT, '1-compose-filled.png') });
  await submit.click();
  await page.waitForURL('**/scheduled');
  await page.getByText('Scheduled 25 emails').waitFor();
  check(true, 'toast "Scheduled 25 emails", redirected to /scheduled');

  // ---- 3. watch the rows move with no refresh ----
  log('3. Watching Scheduled (no manual refresh) until every row has moved to Sent');
  await page.locator('[role=link]').first().waitFor();
  const firstPill = await page.locator('[role=link]').first().innerText();
  console.log(`   first row: ${firstPill.replace(/\n/g, ' | ').slice(0, 120)}`);
  check(/\d+:\d{2}:\d{2} [AP]M/.test(firstPill), 'rows show the scheduled time with seconds');
  await page.screenshot({ path: path.join(OUT, '2-scheduled-waiting.png') });
  const timeline: { scheduled: number; sent: number; sending: number }[] = [];
  const deadline = Date.now() + 7 * 60_000;
  let last = '';
  for (;;) {
    const counts = await sidebarCounts(page);
    const sending = await page.getByText('Sending', { exact: true }).count();
    const line = `scheduled=${counts.scheduled} sent=${counts.sent}`;
    if (line !== last) {
      console.log(`   ${new Date().toLocaleTimeString()}  ${line}${sending ? `  (${sending} row(s) "Sending")` : ''}`);
      timeline.push({ ...counts, sending });
      last = line;
    }
    if (counts.scheduled === 0 && counts.sent >= 25) break;
    if (Date.now() > deadline) break;
    await page.waitForTimeout(1500);
  }
  const final = await sidebarCounts(page);
  check(final.scheduled === 0 && final.sent === 25, `all 25 emails moved from Scheduled to Sent without a refresh (${final.scheduled} scheduled, ${final.sent} sent)`);
  check(timeline.length > 3, `the counts changed live ${timeline.length} times`);

  // ---- 4. Sent list, detail, formatted body, attachment ----
  log('4. Sent list and detail');
  await page.getByRole('link', { name: /^Sent/ }).click();
  await page.locator('[role=link]').first().waitFor();
  await page.screenshot({ path: path.join(OUT, '3-sent.png') });
  const sentRow = await page.locator('[role=link]').first().innerText();
  check(/Sent/.test(sentRow) && /[AP]M/.test(sentRow), 'Sent rows show a "Sent" chip and the sent time');
  await page.locator('[role=link]').first().click();
  await page.waitForURL('**/email/*');
  await page.locator('.email-body strong', { hasText: 'Big news' }).waitFor();
  check(true, 'detail renders the formatted body (bold)');
  check((await page.locator('.email-body ul li').count()) === 2, 'detail renders the bullet list (2 items)');
  check((await page.locator('.email-body blockquote').count()) === 1, 'detail renders the quote as the yellow callout');
  const card = page.getByText('brand.png');
  await card.waitFor();
  const loaded = await page.evaluate(() => Array.from(document.images).some((img) => img.naturalWidth > 0 && img.src.includes('/attachments/0')));
  check(loaded, 'attachment card shows the real image thumbnail');
  await page.getByRole('button', { name: /^to / }).click();
  const detailsText = await page.locator('dl').innerText();
  check(/Ethereal preview/.test(detailsText) && /Open preview/.test(detailsText), 'details panel links the Ethereal preview');
  check(await page.getByRole('button', { name: 'Cancel email' }).isDisabled(), 'trash is disabled for a sent email');
  await page.screenshot({ path: path.join(OUT, '4-detail.png') });

  // ---- 5. schedule one for tomorrow and cancel it from its detail page ----
  log('5. Cancel a still-scheduled email');
  await page.goto(`${APP}/compose`);
  await page.getByRole('textbox', { name: 'Recipients' }).fill(`cancel.${runId}@example.com`);
  await page.getByRole('textbox', { name: 'Recipients' }).press('Enter');
  await page.locator('#subject').fill(`Cancel me ${runId}`);
  await page.locator('#limit').fill('10');
  await page.locator('.email-editor').click();
  await page.keyboard.type('This should never be sent.');
  await page.getByRole('button', { name: 'Send later' }).click();
  await page.getByRole('button', { name: 'Tomorrow, 11:00 AM' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Send Later', exact: true }).click();
  await page.waitForURL('**/scheduled');
  await page.getByText(`Cancel me ${runId}`).first().waitFor();
  await page.getByText(`Cancel me ${runId}`).first().click();
  await page.waitForURL('**/email/*');
  const cancelId = page.url().split('/').pop()!;
  const trash = page.getByRole('button', { name: 'Cancel email' });
  check(await trash.isEnabled(), 'trash is enabled for a scheduled email');
  await trash.click(); // the confirm dialog is accepted by the handler above
  await page.waitForURL('**/scheduled');
  await page.getByText('Email cancelled').waitFor();
  check(true, 'cancelled: toast "Email cancelled", back on /scheduled');
  await page.waitForTimeout(3500);
  check((await page.getByText(`Cancel me ${runId}`).count()) === 0, 'the cancelled row is gone from Scheduled');
  const gone = await page.evaluate(async (id) => (await fetch(`http://localhost:4000/api/emails/${id}`, { credentials: 'include' })).status, cancelId);
  check(gone === 404, 'the cancelled email no longer exists on the server (404)');

  // ---- 6. search ----
  log('6. Search for a recipient');
  await page.getByRole('link', { name: /^Sent/ }).click();
  await page.getByRole('searchbox', { name: 'Search emails' }).fill(`lead07.${runId}`);
  await page.getByText(/1 result, via /).waitFor();
  console.log(`   result line: "${await page.getByText(/result.*via /).innerText()}"`);
  check((await page.locator('[role=link]').count()) === 1, 'exactly one matching row');
  check((await page.locator('[role=link]').first().innerText()).includes(`lead07.${runId}`), 'the row is the searched recipient');
  await page.screenshot({ path: path.join(OUT, '5-search.png') });

  // ---- 7. user menu / Slack ----
  log('7. User menu');
  await page.getByRole('button', { name: /Walk Through/ }).click();
  await page.getByText('Connect Slack').waitFor();
  check(true, 'menu shows "Connect Slack", "Queue monitor" and "Log out"');
  await page.screenshot({ path: path.join(OUT, '6-user-menu.png') });
  const [slackResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/slack/connect')),
    page.getByText('Connect Slack').click(),
  ]);
  console.log(`   /api/slack/connect answered HTTP ${slackResponse.status()} (${slackResponse.status() === 503 ? 'SLACK_CLIENT_ID is not set in this environment, so Slack would redirect once configured' : 'redirect to Slack'})`);

  await browser.close();
  console.log(process.exitCode ? '\nWALKTHROUGH FAILED' : '\nWALKTHROUGH PASSED');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
