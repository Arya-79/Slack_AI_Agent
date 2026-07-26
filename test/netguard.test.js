import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateOrReservedIp, isPlausiblePublicHostname, assertSafePublicHost } from '../src/research/netguard.js';

test('isPrivateOrReservedIp flags loopback, private, link-local, metadata', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.5.5', '169.254.169.254', '0.0.0.0']) {
    assert.equal(isPrivateOrReservedIp(ip), true, ip);
  }
});

test('isPrivateOrReservedIp allows public addresses', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34']) {
    assert.equal(isPrivateOrReservedIp(ip), false, ip);
  }
});

test('isPrivateOrReservedIp handles IPv6 loopback/link-local/unique-local', () => {
  assert.equal(isPrivateOrReservedIp('::1'), true);
  assert.equal(isPrivateOrReservedIp('fe80::1'), true);
  assert.equal(isPrivateOrReservedIp('fd00::1'), true);
  assert.equal(isPrivateOrReservedIp('::ffff:127.0.0.1'), true); // IPv4-mapped loopback
});

test('non-IP strings are treated as unsafe by the IP check', () => {
  assert.equal(isPrivateOrReservedIp('example.com'), true);
});

test('isPlausiblePublicHostname rejects localhost, IPs, and internal suffixes', () => {
  assert.equal(isPlausiblePublicHostname('localhost'), false);
  assert.equal(isPlausiblePublicHostname('foo.local'), false);
  assert.equal(isPlausiblePublicHostname('db.internal'), false);
  assert.equal(isPlausiblePublicHostname('127.0.0.1'), false);
  assert.equal(isPlausiblePublicHostname('not a host'), false);
});

test('isPlausiblePublicHostname accepts real domains', () => {
  assert.equal(isPlausiblePublicHostname('www.example.com'), true);
  assert.equal(isPlausiblePublicHostname('acme.io'), true);
});

test('assertSafePublicHost throws when DNS resolves to a private address', async () => {
  const resolver = { lookup: async () => [{ address: '10.0.0.5', family: 4 }] };
  await assert.rejects(() => assertSafePublicHost('www.evil.test', { resolver }), /private address/);
});

test('assertSafePublicHost passes for public resolution', async () => {
  const resolver = { lookup: async () => [{ address: '93.184.216.34', family: 4 }] };
  const out = await assertSafePublicHost('www.example.com', { resolver });
  assert.deepEqual(out, ['93.184.216.34']);
});
