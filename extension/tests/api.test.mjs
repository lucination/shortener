import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createLink } from "../compiled/extension/src/api.js";

test("POSTs the existing DTO with user bearer authority, not cookies, and refuses redirects", async () => {
  const requests = [];
  let redirect = false;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    requests.push({
      path: req.url,
      method: req.method,
      headers: req.headers,
      body,
    });
    if (redirect) {
      res.writeHead(307, { location: "/leaked" }).end();
      return;
    }
    res
      .writeHead(201, { "content-type": "application/json" })
      .end(JSON.stringify({ addresses: [] }));
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const service = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.deepEqual(
      await createLink(
        {
          service,
          token:
            "short_at_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        },
        { destination: "https://page.example" },
      ),
      { addresses: [] },
    );
    assert.equal(requests[0].path, "/api/links");
    assert.equal(requests[0].method, "POST");
    assert.equal(
      requests[0].headers.authorization,
      "Bearer short_at_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    );
    assert.equal(requests[0].headers.cookie, undefined);
    assert.deepEqual(JSON.parse(requests[0].body), {
      destination: "https://page.example",
    });
    redirect = true;
    await assert.rejects(
      createLink(
        {
          service,
          token:
            "short_at_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        },
        {},
      ),
      /Check your account/,
    );
    assert.equal(
      requests.length,
      2,
      "redirect target never receives credentials",
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
