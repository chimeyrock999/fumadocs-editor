import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";

/**
 * Host names the server answers to besides `localhost`, `*.localhost` and IP
 * addresses, which are always allowed. Same rules as Vite's
 * `server.allowedHosts`: an entry matches that host name exactly, a leading
 * `.` matches the domain and its subdomains, `true` turns the checks off.
 */
export type AllowedHosts = readonly string[] | true;

const parse = (url: string): URL | undefined => {
  try {
    return new URL(url);
  } catch {}
};

const ip = (hostname: string) => isIP(hostname.replace(/^\[(.*)\]$/, "$1")) !== 0;

const localhost = (hostname: string) => hostname === "localhost" || hostname.endsWith(".localhost");

const loopback = (hostname: string) =>
  localhost(hostname) ||
  hostname === "[::1]" ||
  (isIP(hostname) === 4 && hostname.startsWith("127."));

const listed = (hostname: string, hosts: readonly string[]) =>
  hosts.some((entry) =>
    entry.startsWith(".")
      ? hostname === entry.slice(1) || hostname.endsWith(entry)
      : hostname === entry,
  );

/**
 * Whether a request may reach the server from where it came. The Host header
 * must name an allowed host, which stops DNS rebinding (a foreign name
 * resolving to this machine) since an attacker cannot make the browser send
 * an IP address or `localhost` for their own page. A browser request also
 * carries its page's Origin, which must be this server, a loopback origin
 * or an allowed host: browsers let any page open a websocket to any
 * address, so this is what stops a cross-site page from opening one.
 * Requests without an Origin (CLI tools, server-side clients) pass on Host.
 */
export function createHostCheck(allowedHosts: AllowedHosts = []) {
  if (allowedHosts === true) return (_request: IncomingMessage) => true;
  return (request: IncomingMessage): boolean => {
    const { host, origin } = request.headers;
    const self = host === undefined ? undefined : parse(`http://${host}`);
    if (host !== undefined) {
      if (!self) return false;
      if (!ip(self.hostname) && !localhost(self.hostname) && !listed(self.hostname, allowedHosts)) {
        return false;
      }
    }
    if (origin === undefined) return true;
    const from = parse(origin);
    if (!from || (from.protocol !== "http:" && from.protocol !== "https:")) return false;
    return (
      from.host === self?.host || loopback(from.hostname) || listed(from.hostname, allowedHosts)
    );
  };
}
