// Alert emails really go out over SMTP. A tiny fake mail server (Node's `net`, no extra library)
// stands in for the bank's mail server and records what it receives.
import './env';
import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AlertsService } from '../src/alerts/alerts.service';
import { newDeviceToken } from '../src/screens/device-auth';
import * as helpers from './helpers';

interface Received {
  from: string;
  to: string[];
  data: string;
}

/** Speaks just enough SMTP for nodemailer. `refuse` makes it reject every recipient. */
function fakeSmtp() {
  const received: Received[] = [];
  const state = { refuse: false };
  const server: Server = createServer((socket: Socket) => {
    let mail: Received = { from: '', to: [], data: '' };
    let inData = false;
    let buffer = '';
    const say = (line: string) => socket.write(line + '\r\n');
    say('220 fake.test ESMTP');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      while (true) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) return;
          mail.data = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          received.push(mail);
          mail = { from: '', to: [], data: '' };
          say('250 queued');
          continue;
        }
        const nl = buffer.indexOf('\r\n');
        if (nl < 0) return;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') say('250 fake.test');
        else if (cmd === 'MAIL') {
          mail.from = line;
          say('250 ok');
        } else if (cmd === 'RCPT') {
          if (state.refuse) say('550 mailbox unavailable');
          else {
            mail.to.push(line.replace(/^RCPT TO:\s*<?([^>]*)>?.*$/i, '$1'));
            say('250 ok');
          }
        } else if (cmd === 'DATA') {
          inData = true;
          say('354 go ahead');
        } else if (cmd === 'RSET' || cmd === 'NOOP') say('250 ok');
        else if (cmd === 'QUIT') {
          say('221 bye');
          socket.end();
        } else say('502 not implemented');
      }
    });
    socket.on('error', () => {});
  });
  return { server, received, state };
}

const smtp = fakeSmtp();
let t: helpers.TestApp;
let admin: string;
let branchId: string;

const RECIPIENTS = ['it.head@bank.test', 'ho.admin@bank.test'];

before(async () => {
  await new Promise<void>((ok) => smtp.server.listen(0, '127.0.0.1', ok));
  // The mail driver reads these when the app starts.
  process.env.MAIL_DRIVER = 'smtp';
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String((smtp.server.address() as AddressInfo).port);
  process.env.SMTP_SECURE = 'false';
  process.env.MAIL_FROM = 'KDCC Darpan <alerts@bank.test>';
  t = await helpers.startApp();
  await helpers.resetDb(t.prisma);
  branchId = (await helpers.createPlaces(t.prisma)).matarBranch.id;
  admin = await helpers.login(t.base, await helpers.createUser(t.prisma, 'HO_ADMIN'));
  await t.prisma.alertSettings.upsert({
    where: { id: 1 },
    create: { id: 1, enabled: true, offlineAfterMin: 5, recipients: RECIPIENTS, daysOfWeek: [0, 1, 2, 3, 4, 5, 6], onTime: '00:00', offTime: '23:59', closedSaturdays: [] },
    update: { enabled: true, offlineAfterMin: 5, recipients: RECIPIENTS, daysOfWeek: [0, 1, 2, 3, 4, 5, 6], onTime: '00:00', offTime: '23:59', closedSaturdays: [] },
  });
});

after(async () => {
  await t.close();
  await new Promise((ok) => smtp.server.close(ok));
  process.env.MAIL_DRIVER = 'console';
});

beforeEach(() => {
  smtp.received.length = 0;
  smtp.state.refuse = false;
});

async function offlineScreen(name: string) {
  const { hash } = newDeviceToken();
  const silentSince = new Date(Date.now() - 60 * 60_000);
  return t.prisma.screen.create({
    data: { hardwareId: `hw-${hash.slice(0, 12)}`, deviceTokenHash: hash, name, status: 'OFFLINE', branchId, pairedAt: silentSince, lastSeenAt: silentSince },
  });
}

describe('alert emails over SMTP', () => {
  it('"Send test email" delivers one email to every recipient', async () => {
    const res = await helpers.call(t.base, 'POST', '/alerts/test', { cookie: admin });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(smtp.received.length, 1);
    assert.deepEqual([...smtp.received[0].to].sort(), [...RECIPIENTS].sort());
    assert.match(smtp.received[0].from, /alerts@bank\.test/);
    assert.match(smtp.received[0].data, /Subject: KDCC Darpan: test alert/);
  });

  it('a screen going offline produces exactly one email, not one a minute', async () => {
    await offlineScreen('Silent TV');
    const alerts = t.app.get(AlertsService);
    await alerts.check(new Date(), true);
    await alerts.check(new Date(Date.now() + 60_000), true);
    assert.equal(smtp.received.length, 1);
    assert.deepEqual([...smtp.received[0].to].sort(), [...RECIPIENTS].sort());
    assert.match(smtp.received[0].data, /Silent TV/);
  });

  it('when the mail server refuses, the test button says so and the alert is retried next time', async () => {
    smtp.state.refuse = true;
    const res = await helpers.call(t.base, 'POST', '/alerts/test', { cookie: admin });
    assert.equal(res.status, 502);
    assert.match(res.body.message, /mail server/i);

    await t.prisma.screenAlert.deleteMany();
    await t.prisma.screen.deleteMany();
    await offlineScreen('Retry TV');
    const alerts = t.app.get(AlertsService);
    await alerts.check(new Date(), true);
    assert.equal(smtp.received.length, 0);
    assert.equal(await t.prisma.screenAlert.count({ where: { notifiedAt: null, resolvedAt: null } }), 1, 'still waiting to be emailed');

    smtp.state.refuse = false;
    await alerts.check(new Date(Date.now() + 60_000), true);
    assert.equal(smtp.received.length, 1);
    assert.match(smtp.received[0].data, /Retry TV/);
  });
});
