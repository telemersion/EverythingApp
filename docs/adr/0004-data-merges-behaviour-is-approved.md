# Data merges, behaviour is approved

Status: accepted (2026-10-10, collaboration design)

In a shared document, a behaviour change made by one member runs on every other member's machine: the same shape as an npm supply-chain attack, and the risk Patchwork's own team calls out. We decided that data changes merge on their own, while a behaviour change reaches other members only with an **approval**: a maintainer's signature over that behaviour version. A maintainer's own change counts as approved; anyone else's is a behaviour proposal that runs only in its author's copy. Enforcement has two layers. The team server checks every change against the member's role, and every host checks the approval against the current maintainers' device keys before it runs shared behaviour, so a compromised team server can withhold or delay but cannot make anyone run code. The host installs approved versions and never creates or changes behaviour itself; behaviour is developed in a workbench, where neither unapproved code nor the data it produces reaches the team.

## Considered options

- **Every member accepts each change for themselves.** Safest on paper, but in an active team people stop looking and click Accept.
- **No review; behaviour syncs like data.** The Patchwork prototype's model, which it describes as running with scissors.
- **The team server alone enforces.** Simpler, but every host then trusts whatever the server sends.
- **Hosts alone, signatures only, the server a mere relay (Keyhive-style).** Strongest, but revocation and offline role changes are research problems.

## Consequences

- An approval counts only while its signer is a maintainer and the signing device key is registered. When a maintainer leaves or a key is removed, its approvals end: copies keep the behaviour they already run, and the remaining maintainers re-approve in one batch. A departure and a stolen key are handled the same way.
- Every member needs a device key per device, registered with the team server.
- The rule that the host never writes behaviour gets one exception, the same as for kit updates: installing a version that is approved or that the user confirmed.
- A member running an older behaviour must not lose fields a newer one added: scripts keep every field they do not know.
- Looking back in the history runs old behaviour only while its approval is still valid.
