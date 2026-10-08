import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProfileInput } from '../src/core/profile-input.js';
import { fromSteam2, fromSteam3, toSteam2, toSteam3, fromInviteCode, toInviteCode, isSteamId64 } from '../src/core/steamid.js';

const ID = '76561197960287930';

test('accepts a bare SteamID64', () => {
  assert.deepEqual(parseProfileInput(ID), { ok: true, kind: 'id64', value: ID, via: 'id64' });
});

test('accepts profile URLs in many shapes', () => {
  for (const input of [
    `https://steamcommunity.com/profiles/${ID}`,
    `https://steamcommunity.com/profiles/${ID}/`,
    `http://steamcommunity.com/profiles/${ID}/inventory/#730`,
    `steamcommunity.com/profiles/${ID}?l=english`,
    `www.steamcommunity.com/profiles/${ID}`,
    `  <https://steamcommunity.com/profiles/${ID}>  `,
  ]) {
    const r = parseProfileInput(input);
    assert.equal(r.ok, true, input);
    assert.equal(r.value, ID, input);
  }
});

test('accepts vanity URLs and bare vanity names', () => {
  assert.deepEqual(parseProfileInput('https://steamcommunity.com/id/gabelogannewell/'), { ok: true, kind: 'vanity', value: 'gabelogannewell', via: 'url' });
  assert.deepEqual(parseProfileInput('steamcommunity.com/id/some_name-1'), { ok: true, kind: 'vanity', value: 'some_name-1', via: 'url' });
  assert.deepEqual(parseProfileInput('robin'), { ok: true, kind: 'vanity', value: 'robin', via: 'vanity' });
});

test('accepts STEAM_X:Y:Z and [U:1:N]', () => {
  assert.equal(parseProfileInput('STEAM_0:0:11101').value, ID);
  assert.equal(parseProfileInput('STEAM_1:0:11101').value, ID);
  assert.equal(parseProfileInput('[U:1:22202]').value, ID);
  assert.equal(parseProfileInput('U:1:22202').value, ID);
  assert.equal(parseProfileInput(`https://steamcommunity.com/profiles/[U:1:22202]`).value, ID);
});

test('treats a short number as a friend code (account id)', () => {
  const r = parseProfileInput('22202');
  assert.equal(r.ok, true);
  assert.equal(r.value, ID);
  assert.equal(r.via, 'friendcode');
});

test('decodes s.team and /user/ invite links', () => {
  const code = toInviteCode(ID);
  assert.equal(fromInviteCode(code), ID);
  assert.equal(parseProfileInput(`https://s.team/p/${code}`).value, ID);
  assert.equal(parseProfileInput(`steamcommunity.com/user/${code}/ABCDEF`).value, ID);
});

test('rejects invalid input with a helpful message', () => {
  for (const input of ['', '   ', 'https://example.com/profiles/1', 'https://steamcommunity.com/market/', 'STEAM_0:3:1', '12345678901234', 'https://s.team/p/zzzz-zzzz', 'two words']) {
    const r = parseProfileInput(input);
    assert.equal(r.ok, false, input);
    assert.ok(r.error.length > 10, input);
  }
});

test('steamid conversions round-trip', () => {
  assert.equal(isSteamId64(ID), true);
  assert.equal(isSteamId64('76561197960265728'), false); // account id 0
  assert.equal(toSteam2(ID), 'STEAM_1:0:11101');
  assert.equal(toSteam3(ID), '[U:1:22202]');
  assert.equal(fromSteam2('STEAM_1:1:5'), '76561197960265739');
  assert.equal(fromSteam3('[U:1:11]'), '76561197960265739');
});
