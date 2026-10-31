// Visual verification: seeds demo data through the real API, captures every screen at 1600x1000, and writes
// reference | render | difference sheets to docs/figma-compare/.
//
// Needs: docker compose services up, the backend running (npm run dev in backend/) and the frontend dev server
// (npm run dev in frontend/). Run: npm run screenshots
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dayjs from 'dayjs';
import { chromium, type BrowserContext, type Page } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API = process.env.API_URL ?? 'http://localhost:4000';
const APP = process.env.APP_URL ?? 'http://localhost:5173';
const OUT = path.join(ROOT, 'docs/figma-compare');
const FIGMA = path.join(ROOT, 'docs/figma');

// The screenshots in docs/figma are 1372x891: the 1600x1000 design frame appears at (138,152), 1096x685 (scale 0.685).
const FRAME = { x: 138, y: 152, w: 1096, h: 685 };
const SCALE = FRAME.w / 1600;

const USER = { name: 'Oliver Brown', email: 'oliver.brown@domain.io' };
const USER_B = { name: 'Oliver Brown', email: 'oliver.brown.detail@domain.io' };

function psql(sql: string): void {
  execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'reachinbox', '-d', 'reachinbox', '-qc', sql], {
    cwd: ROOT,
    stdio: 'pipe',
  });
}

function mintSession(user: { name: string; email: string }): string {
  const out = execFileSync('npm', ['run', '-s', 'token', '--', user.name, user.email], { cwd: path.join(ROOT, 'backend') }).toString();
  return out.trim().split('\n').pop()!;
}

async function api<T>(cookie: string, route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API}${route}`, {
    method: body ? 'POST' : 'GET',
    headers: { cookie: `session=${cookie}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`${route} -> ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

/** A recognisable PNG (blue sky, a ball and a stripe) drawn in the browser, so no image library is needed. */
async function makePng(page: Page, width: number, height: number): Promise<string> {
  return page.evaluate(
    ([w, h]) => {
      const canvas = document.createElement('canvas');
      canvas.width = w!;
      canvas.height = h!;
      const ctx = canvas.getContext('2d')!;
      const sky = ctx.createLinearGradient(0, 0, 0, h!);
      sky.addColorStop(0, '#1d5fd1');
      sky.addColorStop(1, '#3a86ff');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w!, h!);
      ctx.fillStyle = '#e63946';
      ctx.fillRect(w! * 0.45, h! * 0.35, w! * 0.3, h! * 0.5);
      ctx.fillStyle = '#ffe14d';
      ctx.beginPath();
      ctx.arc(w! * 0.3, h! * 0.3, h! * 0.09, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, h! * 0.88, w!, h! * 0.04);
      return canvas.toDataURL('image/png').split(',')[1]!;
    },
    [width, height],
  );
}

interface Seeded {
  richId: string;
}

async function seed(page: Page): Promise<Seeded> {
  psql("DELETE FROM users WHERE google_id LIKE 'token-script:%'");
  const a = mintSession(USER);
  const b = mintSession(USER_B);
  const soon = () => dayjs().add(1, 'second').toISOString();
  const campaign = (recipient: string, subject: string, body: string, startTime: string, extra: object = {}) => ({
    subject,
    body,
    recipients: [recipient],
    startTime,
    delayBetweenMs: 0,
    hourlyLimit: 100,
    ...extra,
  });

  // Two sent emails (user A)
  await api(a, '/api/campaigns', campaign('sarah.wilson@example.com', 'Re: Project Update', '<p>Thanks for the update, Sarah. Looks good!</p>', soon()));
  await api(a, '/api/campaigns', campaign('support@example.com', 'Issue with login', '<p>I am having trouble logging in to the dashboard...</p>', soon()));

  // Two scheduled emails (user A): next Tuesday 9:15:12 AM and the following Thursday 8:15:12 PM, within 6 days
  const at = (weekday: number, h: number, m: number, s: number) => {
    let d = dayjs().hour(h).minute(m).second(s).millisecond(0);
    while (d.day() !== weekday || d.isBefore(dayjs().add(1, 'hour'))) d = d.add(1, 'day');
    return d.toISOString();
  };
  await api(a, '/api/campaigns', campaign('john.smith@example.com', 'Meeting follow-up - Scheduled', '<p>Hi John, just wanted to follow up on our meeting...</p>', at(2, 9, 15, 12)));
  await api(
    a,
    '/api/campaigns',
    campaign('olive@example.com', "Ramit, great to meet you - you'll love it", '<p>Hi Olive, just wanted to follow up on our meeting...</p>', at(4, 20, 15, 12)),
  );

  // The rich email of screen 04 with two PNG attachments (user B), plus a cancellable scheduled one
  const png = await makePng(page, 640, 360);
  const richBody =
    "<p>Hey Oliver,</p><p>You've just RECEIVED something</p>" +
    '<blockquote><p><strong>⚡ Extremely Exclusive—Only 4 Spots Worldwide Per Year | $25,000 investment ⚡</strong></p>' +
    '<p>⚡ To explore securing your private transformation, simply reply right now with <strong>"FLY OUT FIX"</strong> .</p></blockquote>' +
    '<p>Your coach for world-class performance,</p><p>Grant</p><p><em>P.S. Always remember that you can develop world class technique!🚀</em></p>';
  await api(
    b,
    '/api/campaigns',
    campaign('oliver.hello@example.com', 'Oliver, hello there! | MJWYT44 BM#52W01', richBody, soon(), {
      attachments: [
        { filename: 'Tennis_Coach_Profile.png', contentType: 'image/png', dataBase64: png },
        { filename: 'Tennis_Coach_Profile2.png', contentType: 'image/png', dataBase64: png },
      ],
    }),
  );

  // Wait for the real worker to send them
  const deadline = Date.now() + 90_000;
  for (;;) {
    const sentA = await api<{ total: number }>(a, '/api/emails/sent');
    const sentB = await api<{ total: number }>(b, '/api/emails/sent');
    if (sentA.total >= 2 && sentB.total >= 1) break;
    if (Date.now() > deadline) throw new Error('demo emails were not sent in time: is the backend (with its worker) running?');
    await new Promise((r) => setTimeout(r, 1000));
  }
  const sentB = await api<{ items: { id: string }[] }>(b, '/api/emails/sent');
  return { richId: sentB.items[0]!.id };
}

const sessionCookie = (value: string) => ({ name: 'session', value, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' as const });

async function shot(page: Page, name: string): Promise<string> {
  const file = path.join(OUT, 'render', `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

interface Capture {
  name: string;
  reference: string;
  file: string;
}

async function main(): Promise<void> {
  mkdirSync(path.join(OUT, 'render'), { recursive: true });
  const browser = await chromium.launch();
  const viewport = { width: 1600, height: 1000 };
  const anon = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const anonPage = await anon.newPage();
  const seeded = await seed(anonPage);

  const open = async (user: typeof USER): Promise<[BrowserContext, Page]> => {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    await context.addCookies([sessionCookie(mintSession(user))]);
    const page = await context.newPage();
    page.on('pageerror', (error) => console.error('[page error]', error.message));
    return [context, page];
  };
  const settle = async (page: Page) => {
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
  };

  const captures: Capture[] = [];
  const add = (name: string, reference: string, file: string) => captures.push({ name, reference, file });

  // 01 login (logged out)
  await anonPage.goto(`${APP}/login`);
  await settle(anonPage);
  add('01-login', '01-login.png', await shot(anonPage, '01-login'));

  // 02 / 03 lists (user A)
  const [ctxA, pageA] = await open(USER);
  await pageA.goto(`${APP}/scheduled`);
  await pageA.waitForSelector('text=Meeting follow-up');
  await settle(pageA);
  add('02-scheduled', '02-scheduled.png', await shot(pageA, '02-scheduled'));
  await pageA.goto(`${APP}/sent`);
  await pageA.waitForSelector('text=Re: Project Update');
  await settle(pageA);
  add('03-sent', '03-sent.png', await shot(pageA, '03-sent'));

  // 04 detail (user B)
  const [ctxB, pageB] = await open(USER_B);
  await pageB.goto(`${APP}/email/${seeded.richId}`);
  await pageB.waitForSelector('text=Tennis_Coach_Profile2.png');
  await pageB.waitForFunction(() => Array.from(document.images).every((img) => img.complete && img.naturalWidth > 0));
  await settle(pageB);
  add('04-email-detail', '04-email-detail.png', await shot(pageB, '04-email-detail'));

  // 05 compose + Send Later popover
  await pageA.goto(`${APP}/compose`);
  await settle(pageA);
  await shot(pageA, '05a-compose');
  await pageA.getByRole('button', { name: 'Send later' }).click();
  await pageA.waitForSelector('text=Pick date & time');
  await pageA.waitForTimeout(200);
  add('05-compose-send-later', '05-compose-send-later.png', await shot(pageA, '05-compose-send-later'));

  // 06 attachment + chosen time
  await pageA.getByRole('button', { name: 'Tomorrow, 10:00 AM' }).click();
  await pageA.getByRole('button', { name: 'Done' }).click();
  const pngPath = path.join(OUT, 'render', 'Tennis_Coach_Profile.png');
  writeFileSync(pngPath, Buffer.from(await makePng(pageA, 640, 360), 'base64'));
  await pageA.locator('input[type=file]').first().setInputFiles(pngPath);
  await pageA.waitForSelector('text=Tennis_Coach_Profile.png');
  await settle(pageA);
  add('06-compose-attachment', '06-compose-attachment.png', await shot(pageA, '06-compose-attachment'));

  // 07 seven recipient chips
  const recipients = pageA.getByRole('textbox', { name: 'Recipients' });
  for (const email of ['tame@jmail.com', 'lame@jmail.com', 'dame@jmail.com', 'fame@jmail.com', 'game@jmail.com', 'name@jmail.com', 'same@jmail.com']) {
    await recipients.fill(email);
    await recipients.press('Enter');
  }
  await settle(pageA);
  add('07-compose-recipients', '07-compose-recipients.png', await shot(pageA, '07-compose-recipients'));

  await Promise.all([ctxA.close(), ctxB.close(), anon.close()]);

  // ---- side-by-side sheets: reference | render | difference, all at the reference's own scale ----
  const sheetPage = await (await browser.newContext()).newPage();
  await sheetPage.evaluate('window.__name = (fn) => fn;'); // esbuild (tsx) injects __name into serialized functions
  const hotspots: Record<string, { x: number; y: number; score: number }[]> = {};
  for (const capture of captures) {
    const reference = readFileSync(path.join(FIGMA, capture.reference)).toString('base64');
    const render = readFileSync(capture.file).toString('base64');
    const result = await sheetPage.evaluate(
      async ([ref, ren, frame, scale]) => {
        const load = (b64: string) =>
          new Promise<HTMLImageElement>((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.src = `data:image/png;base64,${b64}`;
          });
        const [a, b] = await Promise.all([load(ref as string), load(ren as string)]);
        const f = frame as { x: number; y: number; w: number; h: number };
        const canvas = document.createElement('canvas');
        canvas.width = f.w * 3 + 20;
        canvas.height = f.h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = '#888';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(a, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
        ctx.drawImage(b, 0, 0, 1600, 1000, f.w + 10, 0, f.w, f.h);
        const left = ctx.getImageData(0, 0, f.w, f.h);
        const right = ctx.getImageData(f.w + 10, 0, f.w, f.h);
        const diff = ctx.createImageData(f.w, f.h);
        const cell = 32;
        const cells = new Map<string, number>();
        for (let y = 0; y < f.h; y += 1) {
          for (let x = 0; x < f.w; x += 1) {
            const i = (y * f.w + x) * 4;
            const d = (Math.abs(left.data[i]! - right.data[i]!) + Math.abs(left.data[i + 1]! - right.data[i + 1]!) + Math.abs(left.data[i + 2]! - right.data[i + 2]!)) / 3;
            const v = 255 - Math.min(255, d * 3);
            diff.data[i] = diff.data[i + 1] = diff.data[i + 2] = v;
            diff.data[i + 3] = 255;
            const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
            cells.set(key, (cells.get(key) ?? 0) + d);
          }
        }
        ctx.putImageData(diff, (f.w + 10) * 2, 0);
        const top = [...cells.entries()]
          .map(([key, sum]) => {
            const [cx, cy] = key.split(',').map(Number);
            return { x: Math.round((cx! * cell + cell / 2) / (scale as number)), y: Math.round((cy! * cell + cell / 2) / (scale as number)), score: Math.round((sum / (cell * cell)) * 10) / 10 };
          })
          .sort((p, q) => q.score - p.score)
          .slice(0, 8);
        const mean = [...cells.values()].reduce((s, v) => s + v, 0) / (f.w * f.h);
        return { png: canvas.toDataURL('image/png').split(',')[1]!, top, mean: Math.round(mean * 100) / 100 };
      },
      [reference, render, FRAME, SCALE] as const,
    );
    writeFileSync(path.join(OUT, `${capture.name}.png`), Buffer.from(result.png, 'base64'));
    hotspots[capture.name] = result.top;
    console.log(`\n${capture.name}: mean difference ${result.mean} (0 = identical). Largest regions (design px, score = mean RGB difference):`);
    for (const h of result.top.slice(0, 5)) console.log(`   around (${h.x}, ${h.y})  ${h.score}`);
  }
  writeFileSync(path.join(OUT, 'hotspots.json'), JSON.stringify(hotspots, null, 2));
  await browser.close();
  console.log(`\nSheets written to ${OUT} (left: Figma reference, middle: render, right: difference)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
