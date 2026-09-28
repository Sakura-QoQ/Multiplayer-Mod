# Security model and 1.0 review

## Trust boundaries

- Public players are untrusted. The room server is logical peer `0` and is the only source of membership, roster, scene decisions and sleep approvals.
- Save files remain local. Neither the bridge nor room server reads, redirects, uploads or stores them.
- Public transport is plain TCP JSON, not confidential transport. Endpoint obfuscation is not authentication or TLS.

## Enforced controls

- 64 KiB maximum frame, bounded strings/arrays/object keys, safe display text, bounded profile chunks and strict command/type allowlists.
- Authenticated connection identity replaces client-claimed peer ID and name. Public clients may target only server authority and cannot forge control packets.
- Global connection slots, 15-second unauthenticated join deadline, 120 requests/second per connection, five-second send timeout, inactivity/AFK cleanup and bounded client queues.
- Player profiles expose only appearance and four aggregate counts. Full story, contacts, posts, photos, flags and save JSON are excluded.
- GitHub Actions are pinned to immutable checkout commit SHAs. The server container runs non-root with a read-only filesystem, no Linux capabilities, `no-new-privileges` and a PID limit.
- Source-pattern build policy gates have been removed; the source builder checks module and translation completeness.

## 1.0 audit fixes

The formal review removed server-control spoofing, cross-player direct-message bypass, unbounded unauthenticated connections, request flooding, stalled sends, unsafe rich-text/log names, oversized request IDs, complete-save profile disclosure, obsolete save-crypto code and two unsafe one-off reverse-engineering tools. Legacy public `worldTime` packets are ignored.

## Residual limitations

Plain TCP permits network observers or an on-path attacker to read or modify traffic. Use a private network or a TLS tunnel when transport confidentiality/integrity is required. The client contains its public endpoint and must not contain reusable secrets. Report suspected security issues privately to the project owner.
