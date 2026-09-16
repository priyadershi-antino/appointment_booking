/**
 * Extracts the real reason a database call failed.
 *
 * Prisma wraps driver errors, and its `message` is only a header — "Invalid
 * `prisma.$queryRaw()` invocation:" and nothing else. The cause that actually matters
 * (ENOTFOUND, ECONNREFUSED, ETIMEDOUT, a TLS rejection, a bad password) sits further
 * down the `cause` chain, alongside libpq-style fields the driver attaches.
 *
 * Without unwrapping it, a misconfigured deployment reports a failure that names nothing
 * and points nowhere, and the only remaining clue is a log stream behind someone else's
 * dashboard.
 */

interface Errorish {
  message?: unknown;
  code?: unknown;
  errno?: unknown;
  syscall?: unknown;
  address?: unknown;
  port?: unknown;
  hostname?: unknown;
  cause?: unknown;
  meta?: unknown;
}

/** Connection strings appear verbatim in some driver errors. Never echo a password. */
function redact(value: string): string {
  return value
    .replace(/:\/\/[^@\s]*@/g, '://***@')
    .replace(/(password=)[^\s&;]+/gi, '$1***')
    .replace(/\s+/g, ' ')
    .trim();
}

function walk(error: unknown, seen: Set<unknown>, out: string[]): void {
  if (!error || typeof error !== 'object' || seen.has(error)) return;
  seen.add(error);

  const candidate = error as Errorish;

  const message = typeof candidate.message === 'string' ? candidate.message.trim() : '';
  // Skip Prisma's content-free wrapper lines so the useful text is not buried.
  if (message && !/^Invalid `prisma\.[^`]+` invocation:?$/.test(message)) {
    out.push(message);
  }

  // Node and libpq attach the operational detail as fields rather than prose.
  const parts: string[] = [];
  if (typeof candidate.code === 'string') parts.push(candidate.code);
  if (typeof candidate.syscall === 'string') parts.push(`syscall=${candidate.syscall}`);
  if (candidate.hostname) parts.push(`host=${String(candidate.hostname)}`);
  else if (candidate.address) parts.push(`address=${String(candidate.address)}`);
  if (candidate.port) parts.push(`port=${String(candidate.port)}`);
  if (parts.length > 0) out.push(parts.join(' '));

  if (candidate.meta && typeof candidate.meta === 'object') walk(candidate.meta, seen, out);
  walk(candidate.cause, seen, out);

  // AggregateError, which is what a DNS name resolving to several unreachable addresses
  // produces — exactly the shape of an IPv6-only host seen from an IPv4-only network.
  const aggregate = (error as { errors?: unknown }).errors;
  if (Array.isArray(aggregate)) {
    for (const inner of aggregate.slice(0, 3)) walk(inner, seen, out);
  }
}

/** Common failures, translated into the thing to actually go and change. */
function hint(detail: string): string | null {
  if (/ENOTFOUND|EAI_AGAIN/i.test(detail)) {
    return 'The database host could not be resolved — check the hostname in DATABASE_URL.';
  }
  if (/ENETUNREACH|EHOSTUNREACH/i.test(detail)) {
    return 'The host resolved but is unreachable. On Supabase this usually means the IPv6-only direct connection; use the Session pooler string instead.';
  }
  if (/ECONNREFUSED/i.test(detail)) {
    return 'Connection refused — check the port. Supabase uses 5432 for session pooling and 6543 for transaction pooling.';
  }
  if (/ETIMEDOUT|timeout/i.test(detail)) {
    return 'The connection timed out, which usually means a firewall or the wrong host.';
  }
  if (/self.signed|certificate|SSL|TLS/i.test(detail)) {
    return 'TLS negotiation failed — append ?sslmode=require to DATABASE_URL.';
  }
  if (/password authentication failed|SASL|28P01/i.test(detail)) {
    return 'The credentials were rejected. Note Supabase pooler users look like postgres.<project-ref>, not postgres.';
  }
  if (/does not exist|3D000/i.test(detail)) {
    return 'That database name does not exist on the server.';
  }
  if (/prepared statement|pgbouncer/i.test(detail)) {
    return 'This looks like transaction-mode pooling. Add ?pgbouncer=true, and use DIRECT_DATABASE_URL for migrations.';
  }
  return null;
}

export function describeDatabaseError(error: unknown): string {
  const collected: string[] = [];
  walk(error, new Set(), collected);

  const detail = redact([...new Set(collected)].join(' | ')) || 'Unknown database error';
  const suggestion = hint(detail);

  return (suggestion ? `${detail} — ${suggestion}` : detail).slice(0, 500);
}
