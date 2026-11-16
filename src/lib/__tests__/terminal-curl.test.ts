import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { handleTerminalCurl } from "../terminal-curl";

const ORIGIN = "https://cyber-minds.github.io";
const limiter = { limit: mock(async () => ({ success: true })) };
const env = { TERMINAL_CURL_LIMITER: limiter };

function request(url: string, origin = ORIGIN): Request {
  return new Request("https://egeuysal.com/api/terminal-curl", {
    method: "POST",
    headers: {
      Origin: origin,
      "CF-Connecting-IP": "203.0.113.10",
      "Content-Type": "text/plain",
    },
    body: JSON.stringify({ url, method: "GET" }),
  });
}

afterEach(() => {
  mock.restore();
  limiter.limit.mockReset();
  limiter.limit.mockResolvedValue({ success: true });
});

describe("terminal curl proxy", () => {
  it("returns public response text and CORS headers to the terminal", async () => {
    const upstreamFetch = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("hello from a public site", {
        status: 200,
        headers: { "content-type": "text/plain", "set-cookie": "private=1" },
      }),
    );

    const response = await handleTerminalCurl(
      request("https://example.com/data"),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(response.headers.get("content-type")).toBe("text/plain");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.text()).toBe("hello from a public site");
    expect(upstreamFetch).toHaveBeenCalledWith(
      new URL("https://example.com/data"),
      expect.objectContaining({ method: "GET", redirect: "manual" }),
    );
    expect(limiter.limit).toHaveBeenCalledWith({ key: "203.0.113.10" });
  });

  it("rejects private and nonstandard destinations before fetching", async () => {
    const upstreamFetch = spyOn(globalThis, "fetch");
    for (const target of [
      "http://localhost/admin",
      "http://127.0.0.1/admin",
      "http://[::1]/admin",
      "https://example.com:8443/",
      "file:///etc/passwd",
    ]) {
      const response = await handleTerminalCurl(request(target), env);
      expect(response.status).toBe(400);
    }
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("checks redirect destinations before following them", async () => {
    const upstreamFetch = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/private" },
      }),
    );

    const response = await handleTerminalCurl(
      request("https://example.com/"),
      env,
    );

    expect(response.status).toBe(502);
    expect(await response.text()).toContain("redirect target is not a public");
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it("limits response output and supports HEAD", async () => {
    const upstreamFetch = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("x".repeat(140 * 1_024), { status: 200 }),
    );
    const bodyResponse = await handleTerminalCurl(
      request("https://example.com/"),
      env,
    );
    const body = await bodyResponse.text();
    expect(bodyResponse.headers.get("x-terminal-output-truncated")).toBe(
      "true",
    );
    expect(body).toContain("output truncated at 128 KiB");
    expect(body.length).toBeLessThan(130 * 1_024);

    upstreamFetch.mockResolvedValue(new Response(null, { status: 200 }));
    const headRequest = new Request("https://egeuysal.com/api/terminal-curl", {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "text/plain" },
      body: JSON.stringify({ url: "https://example.com/", method: "HEAD" }),
    });
    const headResponse = await handleTerminalCurl(headRequest, env);
    expect(upstreamFetch).toHaveBeenLastCalledWith(
      new URL("https://example.com/"),
      expect.objectContaining({ method: "HEAD" }),
    );
    expect(await headResponse.text()).toBe("");
  });

  it("requires the terminal origin and enforces its rate limit", async () => {
    const upstreamFetch = spyOn(globalThis, "fetch");
    const deniedOrigin = await handleTerminalCurl(
      request("https://example.com/", "https://attacker.example"),
      env,
    );
    expect(deniedOrigin.status).toBe(403);

    limiter.limit.mockResolvedValue({ success: false });
    const limited = await handleTerminalCurl(
      request("https://example.com/"),
      env,
    );
    expect(limited.status).toBe(429);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("rejects oversized proxy requests before fetching", async () => {
    const upstreamFetch = spyOn(globalThis, "fetch");
    const response = await handleTerminalCurl(
      new Request("https://egeuysal.com/api/terminal-curl", {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "text/plain" },
        body: "x".repeat(5_000),
      }),
      env,
    );
    expect(response.status).toBe(413);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});
