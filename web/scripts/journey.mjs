/*
 * Drives the real app in a headless browser over the DevTools protocol: find a
 * bottle, open it, send it on, then write and release a letter. Every console
 * error and unhandled exception is collected, so a silent runtime failure in a
 * path that only appears after three clicks cannot hide.
 */
import { spawn } from 'node:child_process';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ORIGIN = 'http://127.0.0.1:5173';
const PORT = 9333;

const problems = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=C:/Users/Administrator/AppData/Local/Temp/edge-cdp-lio',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

async function pageTarget() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error('Edge never exposed a debuggable page');
}

class Session {
  constructor(socket) {
    this.socket = socket;
    this.next = 1;
    this.pending = new Map();
    socket.addEventListener('message', (event) => {
      const frame = JSON.parse(event.data);
      if (frame.id && this.pending.has(frame.id)) {
        const { resolve, reject } = this.pending.get(frame.id);
        this.pending.delete(frame.id);
        if (frame.error) reject(new Error(frame.error.message));
        else resolve(frame.result);
        return;
      }
      this.onEvent(frame);
    });
  }

  onEvent({ method, params }) {
    if (method === 'Runtime.exceptionThrown') {
      problems.push(`exception: ${params.exceptionDetails?.exception?.description ?? 'unknown'}`);
    }
    if (method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(params.type)) {
      problems.push(`console.${params.type}: ${params.args.map((a) => a.value ?? a.description).join(' ')}`);
    }
  }

  send(method, params = {}) {
    const id = this.next++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate failed');
    }
    return result.result.value;
  }

  async go(path) {
    await this.send('Page.navigate', { url: `${ORIGIN}${path}` });
    for (let i = 0; i < 40; i += 1) {
      await sleep(250);
      if ((await this.evaluate('document.readyState')) === 'complete') break;
    }
  }

  text() {
    return this.evaluate('document.querySelector("main")?.innerText ?? ""');
  }

  click(selector) {
    return this.evaluate(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) return false;
      node.click();
      return true;
    })()`);
  }

  clickText(label) {
    return this.evaluate(`(() => {
      const node = [...document.querySelectorAll('button, a')]
        .find((el) => el.textContent.trim().toLowerCase() === ${JSON.stringify(label.toLowerCase())});
      if (!node) return false;
      node.click();
      return true;
    })()`);
  }

  type(selector, value) {
    return this.evaluate(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(node, ${JSON.stringify(value)});
      node.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
  }
}

const checks = [];
function expect(label, condition, detail = '') {
  checks.push({ label, ok: Boolean(condition), detail });
}

const WRITTEN =
  'Whoever finds this: the thing you keep putting off is smaller than the dread of it. Do the first minute of it today and let the rest follow.';

try {
  const target = await pageTarget();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  const page = new Session(socket);
  await page.send('Page.enable');
  await page.send('Runtime.enable');

  // --- Finding, opening, and sending a letter on ----------------------------
  await page.go('/find');
  await sleep(2500);
  let body = await page.text();
  expect('a bottle drifts in', /drifting in/i.test(body), body.slice(0, 80));

  expect('the bottle is a button', await page.click('button.bottle'));
  await sleep(4500);
  body = await page.text();
  expect('the letter opens and reads', /for whoever found it/i.test(body));
  expect('the letter has words', body.length > 200, `${body.length} characters`);
  expect('reply is offered', /write back/i.test(body));
  expect('release is offered', /send it further/i.test(body));

  expect('release is clickable', await page.clickText('Send it further'));
  await sleep(3000);
  body = await page.text();
  expect('the letter goes back in the water', /back into the water/i.test(body));

  // --- Writing and releasing a letter --------------------------------------
  await page.go('/write');
  await sleep(1200);
  expect('the paper accepts text', await page.type('#letter', WRITTEN));
  await sleep(400);
  body = await page.text();
  expect('the counter counts', body.includes(String(WRITTEN.length)), body.slice(0, 120));

  expect('sealing is offered', await page.clickText('Put it in a bottle'));
  await sleep(1200);
  body = await page.text();
  expect('the letter is sealed', /sealed/i.test(body));

  expect('release is offered', await page.clickText('Release into the ocean'));
  await sleep(4000);
  body = await page.text();
  expect('the letter is released', /out there now/i.test(body));

  // --- Reduced motion still completes the whole journey --------------------
  await page.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await page.go('/find');
  await sleep(2500);
  body = await page.text();
  expect('reduced motion still finds the day’s bottle', /drifting in|whoever found it/i.test(body));
  await page.click('button.bottle');
  await sleep(600);
  body = await page.text();
  expect('reduced motion opens the letter without waiting', /for whoever found it/i.test(body));
} finally {
  browser.kill();
}

const failed = checks.filter((c) => !c.ok);
for (const check of checks) {
  console.log(`${check.ok ? 'ok  ' : 'FAIL'} ${check.label}${check.detail ? ` — ${check.detail}` : ''}`);
}
for (const problem of problems) console.log(`page problem: ${problem}`);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length > 0 || problems.length > 0) process.exitCode = 1;
