// Small pure functions that decide important things: which screens a setting reaches, sign-in codes,
// and which links can be broadcast.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isYoutubeHost, youtubeId } from '@darpan/shared';
import { base32Decode, base32Encode, codeAt, decryptSecret, encryptSecret, hashRecoveryCode, verifyCode } from '../src/auth/totp';
import { hashDeviceToken, newDeviceToken, newPairingCode } from '../src/screens/device-auth';
import { appliesTo, type ScreenPlace } from '../src/screens/playlist-resolver.service';
import './env'; // TOTP_ENCRYPTION_KEY for the secret round trip

describe('which screens a setting reaches', () => {
  const screen: ScreenPlace = { id: 's1', branchId: 'b1', branch: { talukaId: 't1', taluka: { regionId: 'r1' } } };
  const unpaired: ScreenPlace = { id: 's2', branchId: null, branch: null };
  const at = (targetType: 'SCREEN' | 'BRANCH' | 'TALUKA' | 'REGION' | 'ALL', id: string | null = null) => ({
    targetType,
    screenId: targetType === 'SCREEN' ? id : null,
    branchId: targetType === 'BRANCH' ? id : null,
    talukaId: targetType === 'TALUKA' ? id : null,
    regionId: targetType === 'REGION' ? id : null,
  });

  it('matches the screen, its branch, taluka, region and everything', () => {
    assert.equal(appliesTo(at('SCREEN', 's1'), screen, false), true);
    assert.equal(appliesTo(at('BRANCH', 'b1'), screen, false), true);
    assert.equal(appliesTo(at('TALUKA', 't1'), screen, false), true);
    assert.equal(appliesTo(at('REGION', 'r1'), screen, false), true);
    assert.equal(appliesTo(at('ALL'), screen, false), true);
  });

  it('does not match other places', () => {
    assert.equal(appliesTo(at('SCREEN', 'other'), screen, false), false);
    assert.equal(appliesTo(at('BRANCH', 'other'), screen, false), false);
    assert.equal(appliesTo(at('TALUKA', 'other'), screen, false), false);
    assert.equal(appliesTo(at('REGION', 'other'), screen, false), false);
  });

  it('can leave out the screen-level setting (to show what the screen inherits)', () => {
    assert.equal(appliesTo(at('SCREEN', 's1'), screen, true), false);
    assert.equal(appliesTo(at('BRANCH', 'b1'), screen, true), true);
  });

  it('gives a screen without a branch only its own settings', () => {
    assert.equal(appliesTo(at('SCREEN', 's2'), unpaired, false), true);
    assert.equal(appliesTo(at('ALL'), unpaired, false), false);
    assert.equal(appliesTo(at('BRANCH', 'b1'), unpaired, false), false);
  });
});

describe('two-step sign-in codes', () => {
  // RFC 6238 test secret: ASCII "12345678901234567890"
  const secret = base32Encode(Buffer.from('12345678901234567890'));

  it('encodes base32 the way authenticator apps expect', () => {
    assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    assert.equal(base32Decode(secret).toString(), '12345678901234567890');
    assert.equal(base32Decode('gezd gnbv-gy3t qojq gezd gnbv gy3t qojq').toString(), '12345678901234567890');
  });

  it('produces the RFC 6238 reference codes (last 6 digits)', () => {
    assert.equal(codeAt(secret, Math.floor(59 / 30)), '287082');
    assert.equal(codeAt(secret, Math.floor(1111111109 / 30)), '081804');
    assert.equal(codeAt(secret, Math.floor(1234567890 / 30)), '005924');
  });

  it('accepts the current code and one step of clock drift either way', () => {
    const now = 1234567890_000;
    const step = Math.floor(now / 30_000);
    assert.equal(verifyCode(secret, codeAt(secret, step), null, now), step);
    assert.equal(verifyCode(secret, codeAt(secret, step - 1), null, now), step - 1);
    assert.equal(verifyCode(secret, codeAt(secret, step + 1), null, now), step + 1);
    assert.equal(verifyCode(secret, codeAt(secret, step - 2), null, now), null);
  });

  it('refuses a code that was already used', () => {
    const now = 1234567890_000;
    const step = Math.floor(now / 30_000);
    assert.equal(verifyCode(secret, codeAt(secret, step), step, now), null);
  });

  it('refuses anything that is not 6 digits', () => {
    assert.equal(verifyCode(secret, '12345', null), null);
    assert.equal(verifyCode(secret, 'abcdef', null), null);
  });

  it('stores secrets encrypted and reads them back', () => {
    const stored = encryptSecret(secret);
    assert.ok(!stored.includes(secret));
    assert.equal(decryptSecret(stored), secret);
    const [v, iv, tag, data] = stored.split('.');
    const tampered = [v, iv, tag, data.slice(0, -2) + (data.endsWith('AA') ? 'BB' : 'AA')].join('.');
    assert.throws(() => decryptSecret(tampered));
  });

  it('accepts recovery codes typed with spaces or capitals', () => {
    assert.equal(hashRecoveryCode('ABCD EFGH'), hashRecoveryCode('abcd-efgh'));
    assert.equal(hashRecoveryCode('abcdefgh'), hashRecoveryCode('abcd-efgh'));
  });
});

describe('TV tokens and pairing codes', () => {
  it('stores only a hash of the device token', () => {
    const { token, hash } = newDeviceToken();
    assert.ok(token.length >= 40);
    assert.equal(hash, hashDeviceToken(token));
    assert.notEqual(hash, token);
  });

  it('makes 6-digit pairing codes, keeping leading zeros', () => {
    for (let i = 0; i < 200; i++) assert.match(newPairingCode(), /^\d{6}$/);
  });
});

describe('broadcast links', () => {
  const id = 'dQw4w9WgXcQ';

  it('finds the video in every common YouTube link', () => {
    for (const url of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtube.com/watch?v=${id}&t=30s`,
      `https://m.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}?si=abc`,
      `https://www.youtube.com/live/${id}?feature=share`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `  https://www.youtube.com/watch?v=${id}  `,
    ]) {
      assert.equal(youtubeId(url), id, url);
    }
  });

  it('finds no video in channel pages and other sites', () => {
    assert.equal(youtubeId('https://www.youtube.com/@NarendraModi/live'), null);
    assert.equal(youtubeId('https://www.youtube.com/channel/UC1NF71EwP41VdjAU1iXdLkw'), null);
    assert.equal(youtubeId('https://www.youtube.com/watch?v=short'), null);
    assert.equal(youtubeId('https://example.com/watch?v=' + id), null);
    assert.equal(youtubeId('not a link'), null);
  });

  it('knows which links are YouTube (so they play in YouTube’s player)', () => {
    assert.equal(isYoutubeHost('https://www.youtube.com/@NarendraModi/live'), true);
    assert.equal(isYoutubeHost('https://youtu.be/' + id), true);
    assert.equal(isYoutubeHost('https://notyoutube.com/x'), false);
    assert.equal(isYoutubeHost('https://cdn.example.com/live/index.m3u8'), false);
  });
});
