# Security

## Threat model

What Sunshop is actually defending against, in rough order of likelihood:

1. **Credential stuffing**: automated login attempts with leaked password lists.
2. **IDOR / horizontal escalation**: a signed-in customer reading another customer's
   order by changing an id in a URL.
3. **Vertical escalation**: a staff account granting itself more privilege.
4. **Injection**. NoSQL operator injection through a JSON body, XSS through a review.
5. **Session theft**: an access or refresh token exfiltrated by an injected script.
6. **Data exposure at rest**: a leaked backup or an over-broad read role.
7. **Denial of service**: volumetric floods, and expensive-query amplification.

What is explicitly _out_ of scope: a compromised pod is assumed to have the
application's own privileges. The mitigations are blast-radius reduction (scoped IAM,
network policy, no metadata access), not prevention.

---

## Authentication

**Access tokens** are 15-minute JWTs. Stateless, so the hot path needs no database
read. They carry `ver`, the user's token version: bumping that column instantly
invalidates every outstanding access token for that user (password change, role change,
forced logout) without a per-request revocation lookup.

**Refresh tokens** are long-lived _opaque_ random strings, never JWTs, stored in Redis
hashed. A Redis dump therefore yields no usable credentials. Every use rotates the
token.

**Reuse detection.** Rotated tokens are remembered for the remaining session lifetime.
If a spent token is presented again, either the user's token was stolen and replayed or
the attacker's was: the API cannot tell which, so it revokes the entire session family
and bumps the token version, forcing full re-authentication. This is the standard
defence from OAuth 2.0 Security BCP §4.13.2.

**Where tokens live.** Browsers get the refresh token as an `httpOnly`, `SameSite`
cookie scoped to the refresh path: a token the JavaScript context cannot read is a
token XSS cannot steal. The access token lives in a module variable, never
`localStorage`: an injected script has to be running _at that moment_ to capture it,
and it dies with the tab. Native clients send `X-Client-Type: mobile` and receive the
refresh token in the body, storing it in `EncryptedSharedPreferences` behind the
Android Keystore.

**Login hardening.** Password verification runs even for a non-existent account, so
response time does not reveal whether an address is registered. Failures are counted
per _account_, not per IP: a distributed stuffing run rotates addresses but keeps
hammering the same handful of emails, and an IP-only limiter never sees it.

**Password storage.** bcrypt at cost 12, chosen over argon2id deliberately: it is a
pure-JS dependency, so the container image needs no native toolchain and the same
artifact runs on arm64 Graviton nodes and x86 laptops. Cost is configurable and
existing hashes upgrade transparently on the next successful login.

---

## Authorization

Two independent layers, both enforced server-side.

**Permissions** answer "may this kind of caller perform this verb at all?": a static
role → permission matrix in `packages/shared/src/rbac.ts`, checked by
`requirePermission()` middleware.

**Data access control** answers "which rows?" Every query for a customer-owned resource
is composed through an ownership scope:

```ts
const filter = scopeOrders(principal, { status: 'paid' });
// staff with order:read:any  → { status: 'paid' }
// a customer                 → { status: 'paid', user: <their id> }
```

Both layers are required. A customer legitimately holds `order:read:own`; without the
scope, `GET /orders/:someoneElsesId` satisfies that permission perfectly. Ownership
failures answer **404, not 403**: confirming that "order X exists but is not yours" is
itself the oracle an enumeration attack needs.

**Escalation guards.** A principal may never assign a role at or above their own rank,
and may never edit their own roles at all. Strictly-greater comparison is what stops an
admin from minting another admin: the classic horizontal-escalation hole. Role changes
require a written reason and land in the audit log.

The client ships the same matrix and uses it to hide UI it cannot use. That is purely
cosmetic; the server never trusts a client-side check.

---

## Input handling

**NoSQL injection.** `{"email": {"$gt": ""}}` posted to a login endpoint matches the
first user in the collection unless something strips the `$`. Sunshop removes
`$`-prefixed and dotted keys: plus `__proto__` and `constructor`: from every body,
query and params object at the HTTP boundary, before any code path can see them. zod
validation then admits only known fields of known types.

Mongoose's global `sanitizeFilter` is deliberately **off**: it rewrites every
object-valued filter containing a `$` key into `$eq`, breaking legitimate
`$in`/`$gte`/`$regex` usage across the codebase unless each is wrapped in
`mongoose.trusted()`: an opt-out that is easy to forget and therefore a worse defence
than sanitising at the entry point.

**XSS.** Review bodies are sanitised by stripping every tag and attribute, not escaping
them. Reviews are plain text; there is no legitimate reason for markup in one. The API
serves JSON with `default-src 'none'`, so a reflected payload in an error message has
nothing to execute against.

**CSRF.** Write verbs require `Content-Type: application/json`, which makes them
non-simple requests subject to CORS preflight. Without that check, a form-encoded POST
from an attacker's page is a "simple request" that preflight never sees: the classic
CSRF vector against a cookie-authenticated API. `SameSite` on the refresh cookie is the
second layer.

---

## Rate limiting

Two layers with different jobs.

**WAF, at the edge**, absorbs volumetric floods before they cost a pod, a Redis round
trip and a database connection. 3,000 requests/5min per IP globally; 100 on
`/api/v1/auth/*`.

**The application limiter** understands _who_ is calling. A distributed token bucket in
a Lua script: atomic across every pod, with the clock read from Redis so node skew
cannot hand anyone extra budget. A token bucket rather than a fixed window because a
fixed window lets a caller spend its whole budget in the last millisecond of window N
and again in the first of window N+1, an instantaneous 2× burst that is exactly what a
stuffing script produces.

Identity is the user id when authenticated: otherwise a client behind corporate NAT
shares one bucket with thousands of colleagues.

The limiter **fails open**. A Redis outage must not take the storefront down with it;
the WAF rule is the backstop for that window.

---

## Data protection

**In transit.** TLS everywhere: ALB to client, pods to DocumentDB (`tls=true` with the
RDS CA bundle baked into the image), pods to ElastiCache (`rediss://` with an auth
token), pods to Elasticsearch.

**At rest.** Three separate customer-managed KMS keys: data, Kubernetes secrets, logs
: so a compromised or revoked key has a bounded blast radius. Kubernetes Secrets get
envelope encryption; without it a Secret is only base64 in etcd.

**Field-level encryption.** Phone numbers are encrypted with AES-256-GCM _above_ the
storage layer, and shadowed by an HMAC blind index so "find the account with this phone
number" still works without decrypting the collection. HMAC rather than a plain hash,
because an attacker holding the database could otherwise brute-force the small
phone-number keyspace in minutes. The threat model here is a leaked backup or an
over-broad read role: not a compromised pod, which necessarily holds the key.

**Logs.** Pino redacts a deliberately broad list of paths: passwords, tokens, cookies,
authorization headers, card fields. Every one of those is a field that has, in some
incident somewhere, ended up in a log aggregator half the company can read. The cost of
redacting a harmless field is nothing.

**Account deletion** anonymises rather than hard-deletes. Order records carry tax and
accounting obligations that outlive the account; cascading a delete through them would
corrupt historical revenue. The personal data is destroyed, the financial record
survives with no route back to a person.

---

## Secrets

Nothing sensitive is in git: not even encrypted. Terraform generates credentials and
writes them to AWS Secrets Manager; the External Secrets Operator syncs them into a
Kubernetes Secret using the workload's own IRSA identity, refreshing every 15 minutes.
Rotating a database password propagates without a commit or a manual `kubectl`.

No AWS access keys exist anywhere in the cluster. Pods assume IAM roles through a
projected web-identity token (IRSA), scoped to a single namespace and service account:
a `StringLike` wildcard there would let any pod in the cluster assume the role.

The API role is scoped to exactly what it does: read and write its own media prefixes,
send mail from one verified address, read its own seven secrets. No wildcard resource
anywhere.

The configuration validator refuses to boot in production with a development
placeholder secret, `COOKIE_SECURE=false`, a wildcard CORS origin, or a missing field
encryption key. A pod that never passes readiness is far better than one that fails at
the first login _after_ the deployment has rolled forward.

---

## Container and cluster hardening

- Non-root (uid 10001), read-only root filesystem, all capabilities dropped,
  `RuntimeDefault` seccomp, `allowPrivilegeEscalation: false`.
- The namespace enforces the `restricted` Pod Security Standard: enforced, not audited;
  a warning nobody reads is not a control.
- Default-deny NetworkPolicy, then explicit egress to DNS, the data tier, the OTel
  collector, and HTTPS: **excluding `169.254.169.254/32`**, because reaching the
  instance metadata service is how a compromised pod escalates to the node's IAM role.
- `tini` as PID 1, so SIGTERM actually reaches Node and the graceful shutdown runs.
- Images are scanned in CI and the build fails on a HIGH or CRITICAL with a known fix.

---

## Audit trail

Every privileged action is recorded: who, what, from where, and why. Reason text is
mandatory on role changes, suspensions and refunds: "someone made this person an admin
last March" is exactly the question asked six months later.

The collection is append-only by construction: the Mongoose model throws on any update
or delete, and the API exposes no mutation. In AWS it is additionally streamed to an S3
bucket with Object Lock in compliance mode, so not even the account root can erase a
record before its retention expires. An audit trail a compromised admin can delete is
not an audit trail.

Writes are fire-and-forget. A failed audit write must not roll back a successful refund
: it is logged at error level and alerted on instead.

---

## Known gaps

Stated plainly, because a security document that claims completeness is not credible:

- **No CSP nonces on the SPAs.** Both use `style-src 'unsafe-inline'` for Tailwind's
  injected styles. Tightening this needs a nonce-aware build.
- **TOTP only, no WebAuthn.** Phishing-resistant second factors are the right answer
  for staff accounts; TOTP is what is implemented.
- **No breached-password API call.** The check is against a small local list; the
  k-anonymity lookup against Have I Been Pwned is stubbed.
- **No per-tenant encryption keys.** One field-encryption key for the deployment.
- **PCI scope is avoided, not audited.** Card data never touches the API: the browser
  tokenises directly with Stripe: but that claim has not been formally assessed.
