# PDSChain Phase 15: Explorer Security, Privacy, and Accessibility

## 1. Security Architecture & Threat Model

The PDSChain Explorer is designed under a **strict zero-trust, read-oriented threat model**. As a public-facing blockchain interface, it must remain immune to malicious transaction inputs, injection payloads embedded in smart contract strings, and credential leakage.

---

## 2. Security Safeguards

### 2.1 XSS & Injection Prevention
- **HTML Entity Escaping**: Every dynamic value inserted into the DOM (hashes, addresses, transaction IDs, commodity descriptions, error messages, decoded ABI arguments) passes through the strict `escapeHtml()` function:
  - `&` -> `&amp;`
  - `<` -> `&lt;`
  - `>` -> `&gt;`
  - `"` -> `&quot;`
  - `'` -> `&#039;`
- **HTTP Security Headers**: Enforced across all responses:
  - `X-Content-Type-Options: nosniff`: Prevents MIME-type sniffing.
  - `X-Frame-Options: DENY`: Protects against clickjacking.
  - `X-XSS-Protection: 1; mode=block`: Activates browser XSS filtering.
  - `Referrer-Policy: strict-origin-when-cross-origin`: Restricts sensitive path leakage in referrers.

### 2.2 Zero Secret Exposure
- **Recursive Secret Scrubbing**: All response envelopes and error objects pass through `ResponseEnvelope.sanitizeSecrets()`.
- **Protected Fields**: Private keys (`Ed25519`, `secp256k1`), TLS certificate keys, keystore passphrases, seed phrases, and challenge nonces are redacted with `"[REDACTED]"`.
- **No Stack Trace Leakage**: Production 404, 400, and 500 error responses return canonical error envelopes with structured error codes (`BLOCK_NOT_FOUND`, `VALIDATION_ERROR`) and never expose internal file paths, database connection strings, or call stacks.

---

## 3. Accessibility & UX Quality (WCAG 2.1 AA Compliance)

1. **Semantic HTML & ARIA Landmarks**:
   - Proper use of `<header role="banner">`, `<main>`, `<nav aria-label="...">`, `<section>`, `<div role="status" aria-live="polite">`.
   - Modals implement `role="dialog"`, `aria-modal="true"`, and `aria-labelledby`.
2. **Keyboard Navigation & Focus Management**:
   - Universal search is accessible via global keyboard shortcut `/`.
   - `Escape` dismisses search dropdowns and modal inspectors.
   - All interactive controls (tabs, copy buttons, links) feature visible `:focus-visible` styling with 2px indigo outline.
3. **Color Contrast & State Redundancy**:
   - All text and badge elements meet or exceed WCAG 2.1 AA 4.5:1 contrast ratios.
   - Status indicators pair colors with text labels and iconography (e.g. green plus `<i class="bi bi-check-circle-fill"></i>` for `FINALIZED`), ensuring users with color blindness are not misled.
4. **Motion Sensitivity**:
   - CSS rules respect `@media (prefers-reduced-motion: reduce)`, disabling pulsing animations and instant transitions for users with vestibular sensitivities.

