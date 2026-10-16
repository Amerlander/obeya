// Who may talk to the server: every request and WebSocket upgrade, from this machine too, names one
// of Obeya's own hosts and comes from no other site. A page elsewhere in the owner's browser may
// send requests to 127.0.0.1 (a `text/plain` POST needs no preflight) and a DNS name rebound to it
// reaches the server under that name; neither gets an answer. Who comes from another device is the
// gate's to say (remote.ts).

/** The names this machine reaches Obeya by. */
export const LOCAL_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]'];

const PLAIN = { 'content-type': 'text/plain; charset=utf-8' };

/** The name in a `Host` header, without its port: `127.0.0.1`, `[::1]`. */
export function hostname(host: string): string {
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]!;
  return name.toLowerCase();
}

/**
 * Why `req` gets no answer, as the answer it gets instead; `null` when it may have one.
 *
 * - `Host` (and `X-Forwarded-Host`, where a proxy set it) names none of `hosts`: 421 (a foreign
 *   name, a DNS name rebound to this machine). Its port is not checked: a worker on another
 *   machine reaches Obeya through a forwarded port of its own.
 * - An `Origin` other than the address the request was sent to (as `tailscale serve` forwards it:
 *   `X-Forwarded-Proto` and `-Host`), or `Sec-Fetch-Site: cross-site`: 403. A request with neither
 *   (the app's shell, scripts, curl) passes. A page elsewhere cannot set the forwarded headers
 *   without a preflight, which Obeya does not answer.
 * - `files`: a GET of one of the workers' files (an HTML artifact's page and what it loads). Its
 *   sandboxed frame has an origin of its own (`null`), so the browser marks what it loads as
 *   cross-site; what it loads is read only by that frame and changes nothing.
 */
export function refusal(req: Request, hosts: readonly string[], files = false): Response | null {
  const host = req.headers.get('host');
  const forwarded = req.headers.get('x-forwarded-host');
  if (!host || !hosts.includes(hostname(host)) || (forwarded && !hosts.includes(hostname(forwarded)))) {
    const port = host?.match(/:(\d+)$/)?.[1];
    return new Response(`Not one of Obeya's addresses. On its machine Obeya answers at http://127.0.0.1${port ? `:${port}` : ''}/\n`, { status: 421, headers: PLAIN });
  }
  if (files && (req.method === 'GET' || req.method === 'HEAD')) return null;
  const origin = req.headers.get('origin');
  const proto = req.headers.get('x-forwarded-proto');
  const own = `${proto ? `${proto}:` : new URL(req.url).protocol}//${(forwarded ?? host).toLowerCase()}`;
  if ((origin !== null && origin.toLowerCase() !== own) || req.headers.get('sec-fetch-site') === 'cross-site') return new Response("Obeya answers its own page, not another site's.\n", { status: 403, headers: PLAIN });
  return null;
}

/** Who may come in beyond what `refusal` checks: other devices (remote.ts). */
export interface Gate {
  /** The names requests may come under. */
  hosts(): readonly string[];
  /** The answer a request to `route` gets instead of the route's own, or `null` to let it through. */
  admit(req: Request, server: Bun.Server<unknown>, route: string): Response | null;
}

/** Only this machine, as before other devices could reach Obeya. */
export const LOCAL_ONLY: Gate = { hosts: () => LOCAL_HOSTS, admit: () => null };

type Routes<D, R extends string> = Bun.Serve.RoutesWithUpgrade<D, R>;
type Handler = (req: Request, server: Bun.Server<unknown>) => unknown;

/** The routes that serve the workers' files: an HTML artifact's, a looked-up answer's. */
const FILES = ['/cards/:id/demo/*', '/threads/:thread/files/*'];

/**
 * `routes`, each answering only what `refusal` and then `gate` let through. An HTML page (Bun serves its bundle
 * itself, past any handler) moves to a path nobody knows, and its own path fetches it from there
 * once the request passed.
 */
export function guarded<D, R extends string>(routes: Routes<D, R>, gate: Gate = LOCAL_ONLY): Routes<D, R> {
  const out: Record<string, unknown> = {};
  for (const [path, value] of Object.entries<unknown>(routes)) {
    const files = FILES.some((f) => path.endsWith(f));
    const checked = (handler: Handler): Handler => (req, server) => refusal(req, gate.hosts(), files) ?? gate.admit(req, server, path) ?? handler(req, server);
    if (typeof value === 'function') out[path] = checked(value as Handler);
    else if (value && typeof value === 'object' && 'index' in value) {
      const hidden = `/_page/${crypto.randomUUID()}${path}`;
      out[hidden] = value;
      out[path] = checked((req, server) => {
        const etag = req.headers.get('if-none-match');
        return fetch(new URL(hidden, server.url), { headers: etag ? { 'if-none-match': etag } : {} });
      });
    } else if (value && typeof value === 'object' && Object.values(value).every((h) => typeof h === 'function')) {
      out[path] = Object.fromEntries(Object.entries(value as Record<string, Handler>).map(([method, h]) => [method, checked(h)]));
    } else throw new Error(`route ${path}: a kind of route the check does not know`);
  }
  return out as Routes<D, R>;
}
