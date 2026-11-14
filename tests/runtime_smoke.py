"""Real loopback Loco + SQLite + local Mailpit smoke. No fabricated provider responses."""
import argparse
import http.cookiejar
import json
import pathlib
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    args = argparse.ArgumentParser()
    args.add_argument("--env", required=True)
    args.add_argument("--receipt", required=True)
    options = args.parse_args()
    env = dict(line.split("=", 1) for line in pathlib.Path(options.env).read_text().splitlines() if line and not line.startswith("#"))
    base = env["APP_ORIGIN"]
    assert urllib.parse.urlparse(base).hostname in ("localhost", "127.0.0.1"), "smoke is local-only"
    smtp = env.get("SMTP_HOST", "127.0.0.1")
    assert smtp in ("localhost", "127.0.0.1"), "never submit smoke mail externally"
    jar = http.cookiejar.CookieJar()
    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), NoRedirect())

    def request(path, method="GET", data=None, form=False, ua="Mozilla/5.0 Firefox/120.0 Linux"):
        headers = {"Origin": base, "User-Agent": ua}
        body = None
        if data is not None:
            body = (urllib.parse.urlencode(data) if form else json.dumps(data)).encode()
            headers["Content-Type"] = "application/x-www-form-urlencoded" if form else "application/json"
        try:
            response = client.open(urllib.request.Request(base + path, body, headers, method=method), timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        raw = response.read()
        content = json.loads(raw) if "application/json" in response.headers.get("Content-Type", "") else raw.decode()
        return response.code, content, response.headers

    for _ in range(100):
        try:
            if request("/_health")[0] == 200:
                break
        except OSError:
            pass
        time.sleep(0.1)
    else:
        raise AssertionError("Loco did not become healthy")

    assert request("/api/me")[0] == 401
    assert request("/api/admin/login", "POST", {"token": env["ADMIN_TOKEN"]})[0] == 200
    unique = uuid.uuid4().hex[:10]
    email = "smoke-" + unique + "@example.test"
    status, user, _ = request("/api/admin/users", "POST", {"email": email, "retention_days": 7, "link_quota": 10})
    assert status == 201, (status, user)
    assert request("/api/auth/magic-link", "POST", {"email": email})[0] == 200
    token = None
    for _ in range(50):
        messages = json.load(urllib.request.urlopen("http://127.0.0.1:8025/api/v1/messages"))["messages"]
        for item in messages:
            if any(recipient["Address"] == email for recipient in item["To"]):
                mail = json.load(urllib.request.urlopen("http://127.0.0.1:8025/api/v1/message/" + item["ID"]))
                token = re.search(r"/auth/verify\?token=([a-f0-9]+)", mail["Text"]).group(1)
        if token:
            break
        time.sleep(0.1)
    assert token, "actual SMTP mail did not reach Mailpit"
    status, _, headers = request("/auth/verify?token=" + token)
    assert status == 303 and headers["Location"] == "/"
    assert "HttpOnly" in headers["Set-Cookie"]
    assert request("/auth/verify?token=" + token)[0] == 404, "magic token replay"
    assert request("/api/me")[1]["id"] == user["id"]
    alias = "smoke-" + unique
    status, link, _ = request("/api/links", "POST", {"destination": "https://example.test/path?fixed=1", "alias": alias, "query_mode": "preserve", "click_limit": 5})
    assert status == 201, (status, link)
    status, _, headers = request("/" + alias + "?fixed=9&x=2&x=3")
    assert status == 302 and headers["Location"] == "https://example.test/path?fixed=1&x=2&x=3"
    assert request("/v/" + alias)[0] == 200
    status, stats, _ = request(f"/api/links/{link['id']}/stats")
    assert status == 200 and stats["humans"] == 1 and stats["previews"] == 1, stats
    assert request(f"/api/links/{link['id']}/events")[1]["total"] == 2
    assert request("/api/links")[1]["total"] == 1
    assert request(f"/api/admin/users/{user['id']}", "PATCH", {"suspended": True})[0] == 200
    assert request("/api/me")[0] == 401
    assert request("/" + alias)[0] == 404
    assert request(f"/api/admin/users/{user['id']}", "PATCH", {"suspended": False})[0] == 200
    assert request("/" + alias)[0] == 302
    receipt = {"user_id": user["id"], "link_id": link["id"], "alias": alias, "destination": link["destination"], "smtp": "Mailpit actual delivery", "checks": ["native Loco health", "admin session", "admin-only account creation", "SMTP magic-link delivery", "HttpOnly redirect cookie", "one-time token", "owned create", "302 repeated query merge", "preview not counted as human", "stats and events", "suspension revocation and generic 404", "reactivation"]}
    pathlib.Path(options.receipt).write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps({"result": "PASS", "user_id": user["id"], "link_id": link["id"], "checks": len(receipt["checks"])}))


if __name__ == "__main__":
    main()
