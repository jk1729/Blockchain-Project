# PDSChain Phase 9: Peer Authentication & Cryptographic Identity Handshake

## 1. Objective

To guarantee that only authorized, institutional validator nodes can join the PDSChain validator mesh, exchange consensus statements, propose candidate blocks, or request state synchronization, while ensuring that validator private keys are never transmitted, exposed, or leaked across the wire.

---

## 2. Mutual Ed25519 Challenge-Response Protocol

The handshake protocol operates symmetrically in 3 distinct message envelopes:

```text
Initiator (VAL-01)                                      Responder (VAL-02)
       |                                                        |
       |  1. HANDSHAKE { challenge: NonceA }                    |
       |------------------------------------------------------->|
       |                                                        |
       |  2. HANDSHAKE_ACK { responseSigA, challenge: NonceB }  |
       |<-------------------------------------------------------|
       |                                                        |
       |  3. HANDSHAKE_COMPLETE { responseSigB }                |
       |------------------------------------------------------->|
       |                                                        |
[VAL-02 Authenticated]                                   [VAL-01 Authenticated]
```

### Step-by-Step Sequence:

1. **Step 1 — Initiation (`HANDSHAKE`)**:
   - The initiating validator (`VAL-01`) opens an outbound TCP/TLS connection to `VAL-02:5002`.
   - `VAL-01` generates a secure random 32-byte cryptographic nonce (`NonceA`) using `crypto.randomBytes(32).toString('hex')`.
   - `VAL-01` stores `NonceA` in its active challenge table with a 10-second TTL.
   - `VAL-01` transmits a `HANDSHAKE` envelope containing `NonceA` to `VAL-02`.

2. **Step 2 — Acknowledgment & Counter-Challenge (`HANDSHAKE_ACK`)**:
   - `VAL-02` receives the `HANDSHAKE` envelope and validates the protocol version, network ID (`pdschain-devnet`), and chain ID (`1729`).
   - `VAL-02` signs `NonceA` using its local Ed25519 private key:
     $$\text{responseSigA} = \text{sign}\left(\text{"PDSCHAIN\_NET\_AUTH:VAL-02:"} \parallel \text{NonceA}, \text{privKey}_{\text{VAL-02}}\right)$$
   - `VAL-02` generates its own secure 32-byte counter-challenge nonce (`NonceB`) with a 10-second TTL.
   - `VAL-02` transmits a `HANDSHAKE_ACK` envelope containing `responseSigA` and `NonceB` back to `VAL-01`.

3. **Step 3 — Verification & Completion (`HANDSHAKE_COMPLETE`)**:
   - `VAL-01` receives the `HANDSHAKE_ACK` envelope.
   - `VAL-01` retrieves the registered Ed25519 public key of `VAL-02` from its local institutional registry.
   - `VAL-01` cryptographically verifies `responseSigA` against `NonceA`. If verification fails, the connection is instantly severed.
   - `VAL-01` signs `NonceB` using its local Ed25519 private key:
     $$\text{responseSigB} = \text{sign}\left(\text{"PDSCHAIN\_NET\_AUTH:VAL-01:"} \parallel \text{NonceB}, \text{privKey}_{\text{VAL-01}}\right)$$
   - `VAL-01` marks `VAL-02` as `CONNECTED` and authenticated.
   - `VAL-01` transmits a `HANDSHAKE_COMPLETE` envelope containing `responseSigB` to `VAL-02`.

4. **Final Step — Responder Verification**:
   - `VAL-02` receives `HANDSHAKE_COMPLETE` and verifies `responseSigB` using the registered public key of `VAL-01`.
   - `VAL-02` marks `VAL-01` as `CONNECTED` and authenticated.
   - Both nodes enter normal consensus message routing mode.

---

## 3. Security Guarantees & Replay Protection

1. **Single-Use Challenge Nonces**:
   Each challenge nonce is consumed upon verification (`consumeChallenge(nonce)`). Replaying a captured handshake packet fails immediately.

2. **10-Second Expiration (TTL)**:
   Non-consumed challenge nonces expire after 10,000 ms, defending against delayed replay attacks.

3. **Domain Separation String**:
   All signed payloads are prefixed with the explicit domain separator:
   `PDSCHAIN_NET_AUTH:<validatorId>:<nonce>`
   This prevents cross-protocol signature substitution attacks (e.g. attempting to use a vote signature as a handshake signature).

4. **Zero Key Exposure**:
   Private keys never cross the process boundary. Only random challenge nonces are signed.

