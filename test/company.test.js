import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPersonalEmail, domainFromEmail, extractTitle, getCompanyInfo } from '../src/research/company.js';

test('isPersonalEmail detects consumer providers', () => {
  assert.equal(isPersonalEmail('a@gmail.com'), true);
  assert.equal(isPersonalEmail('a@ProtonMail.com'), true);
  assert.equal(isPersonalEmail('a@acme.io'), false);
  assert.equal(isPersonalEmail(''), false);
  assert.equal(isPersonalEmail(undefined), false);
});

test('domainFromEmail lowercases and trims', () => {
  assert.equal(domainFromEmail('Jo@Acme.IO'), 'acme.io');
  assert.equal(domainFromEmail('no-at-sign'), null);
  assert.equal(domainFromEmail(null), null);
});

test('extractTitle pulls and collapses whitespace', () => {
  assert.equal(extractTitle('<html><title>  Acme   Inc  </title></html>', 'fb'), 'Acme Inc');
  assert.equal(extractTitle('<html>no title</html>', 'Company: acme.io'), 'Company: acme.io');
  assert.equal(extractTitle(undefined, 'fb'), 'fb');
});

test('getCompanyInfo returns null on fetch failure (degrades gracefully)', async () => {
  const http = {
    get: async () => {
      throw new Error('network down');
    },
  };
  const out = await getCompanyInfo('acme.io', { http });
  assert.equal(out, null);
});

test('getCompanyInfo refuses SSRF-y hostnames before any fetch', async () => {
  let called = false;
  const http = {
    get: async () => {
      called = true;
      return { data: '' };
    },
  };
  // domain "foo.local" -> host "www.foo.local", a .local (internal/mDNS)
  // name. The guard rejects it structurally, so http.get must never run —
  // no DNS lookup involved, so this stays deterministic offline.
  const out = await getCompanyInfo('foo.local', { http });
  assert.equal(out, null);
  assert.equal(called, false);
});

test('getCompanyInfo pins the socket to the vetted address (blocks DNS rebinding)', async () => {
  const resolver = { lookup: async () => [{ address: '93.184.216.34', family: 4 }] };
  let pinnedLookup;
  const http = {
    get: async (url, cfg) => {
      pinnedLookup = cfg.lookup;
      return { data: '<title>Acme</title>' };
    },
  };
  const out = await getCompanyInfo('acme.io', { http, resolver });
  assert.ok(out);
  assert.equal(out.title, 'Acme');

  // The lookup axios will use must resolve to the pre-vetted public IP, not
  // whatever the hostname resolves to at connect time.
  const pinned = await new Promise((res, rej) =>
    pinnedLookup('www.acme.io', {}, (err, addr, fam) => (err ? rej(err) : res({ addr, fam }))),
  );
  assert.equal(pinned.addr, '93.184.216.34');
  assert.equal(pinned.fam, 4);
});

test('getCompanyInfo returns null when DNS resolves to a private address', async () => {
  const resolver = { lookup: async () => [{ address: '10.0.0.9', family: 4 }] };
  let called = false;
  const http = {
    get: async () => {
      called = true;
      return { data: '' };
    },
  };
  const out = await getCompanyInfo('rebind.example', { http, resolver });
  assert.equal(out, null);
  assert.equal(called, false); // guard threw before any fetch
});
