import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import assert from 'node:assert/strict';

// Authorization Code + PKCE S256, real browser consent. No user password or token is printed/stored.
const resource = process.env.MCP_RESOURCE_URL || 'http://localhost:3000/mcp';
const metadataUrl = new URL('/.well-known/oauth-protected-resource/mcp', resource);
const metadataResponse = await fetch(metadataUrl);
assert.equal(metadataResponse.status, 200);
const metadata = await metadataResponse.json();
assert.equal(metadata.resource, resource);
const discovery = await (await fetch(`${metadata.authorization_servers[0]}/.well-known/openid-configuration`)).json();
const challenge = await fetch(resource, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: '{}' });
assert.equal(challenge.status, 401);
assert.match(challenge.headers.get('www-authenticate') || '', /resource_metadata=.*scope="prestige:read"/);
const verifier = randomBytes(48).toString('base64url');
const state = randomBytes(24).toString('base64url');
const redirect = process.env.MCP_REDIRECT_URI || 'http://127.0.0.1:9321/callback';
const callbackUrl = new URL(redirect);
assert.ok(['127.0.0.1', 'localhost'].includes(callbackUrl.hostname), 'Callback debe ser loopback');
const authorize = new URL(discovery.authorization_endpoint);
for (const [k, v] of Object.entries({ client_id: 'prestige-mcp-client', redirect_uri: redirect, response_type: 'code', scope: 'openid prestige:read', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource })) authorize.searchParams.set(k, v);
const rpc = async (token, method, params, id = 1) => {
  const response = await fetch(resource, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
  assert.equal(response.status, 200, `${method}: HTTP ${response.status}`);
  const body = await response.json(); assert.equal(body.error, undefined, `${method}: error MCP`); return body.result;
};
let finished = false;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, redirect);
  if (url.pathname !== callbackUrl.pathname) { res.writeHead(404).end(); return; }
  try {
    assert.equal(url.searchParams.get('state'), state, 'state incorrecto');
    assert.ok(url.searchParams.get('code'), `OAuth: ${url.searchParams.get('error') || 'sin código'}`);
    const exchange = await fetch(discovery.token_endpoint, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', client_id: 'prestige-mcp-client', redirect_uri: redirect, code: url.searchParams.get('code'), code_verifier: verifier, resource }) });
    assert.equal(exchange.status, 200, `Canje PKCE HTTP ${exchange.status}`);
    const { access_token } = await exchange.json(); assert.ok(access_token);
    const init = await rpc(access_token, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'prestige-verifier', version: '1.0' } });
    assert.equal(init.serverInfo.name, 'prestige');
    const list = await rpc(access_token, 'tools/list', {});
    assert.equal(list.tools.length, 5);
    for (const tool of list.tools.filter(t => t.name !== 'prestige_request_status')) {
      const result = await rpc(access_token, 'tools/call', { name: tool.name, arguments: { limit: 2 } });
      assert.ok(!result.isError, `${tool.name} falló`);
      assert.ok(Array.isArray(result.structuredContent.data));
      console.log(`${tool.name}: OK (${result.structuredContent.data.length})`);
      if (tool.name === 'prestige_my_requests' && result.structuredContent.data[0]?.id) {
        const detail = await rpc(access_token, 'tools/call', { name: 'prestige_request_status', arguments: { requestId: result.structuredContent.data[0].id } });
        assert.ok(!detail.isError); assert.equal(detail.structuredContent.data.id, result.structuredContent.data[0].id);
        console.log('prestige_request_status: OK');
      }
    }
    const forbidden = await fetch(resource, { method: 'POST', headers: { Authorization: `Bearer ${access_token}`, 'X-Tenant-Id': 'mcp-foreign-tenant', 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(forbidden.status, 403);
    const hostile = await fetch(resource, { method: 'POST', headers: { Authorization: `Bearer ${access_token}`, Origin: 'https://hostile.example', 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(hostile.status, 403);
    console.log('OAuth PKCE S256 + MCP initialize/list/call + aislamiento tenant/origin: OK');
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Prestige MCP verificado. Puedes cerrar esta pestaña.');
    finished = true; server.close(); clearTimeout(timeout);
  } catch (error) {
    console.error(error.message); res.writeHead(500).end('Falló la verificación. Consulta la terminal.'); process.exitCode = 1; finished = true; server.close(); clearTimeout(timeout);
  }
});
const timeout = setTimeout(() => { if (!finished) { console.error('Tiempo de autorización agotado'); process.exitCode = 1; server.close(); } }, 300_000);
server.listen(Number(callbackUrl.port), callbackUrl.hostname, () => console.log(`Autoriza en navegador: ${authorize.href}`));
