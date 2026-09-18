const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const tlsDir = path.resolve(__dirname);
const opensslPath = 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe';

function runOpenssl(cmd) {
  const fullCmd = `"${opensslPath}" ${cmd}`;
  return execSync(fullCmd, { cwd: tlsDir, stdio: 'pipe' });
}

function generateAll() {
  console.log('Generating Phase 12 TLS/mTLS Test Fixtures...');

  // 1. Root Consortium CA
  runOpenssl('req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -subj "/CN=PDSChain Root CA/O=PDSChain Consortium" -days 3650');

  // 2. Validators VAL-01, VAL-02, VAL-03
  const validators = ['VAL-01', 'VAL-02', 'VAL-03'];
  for (const vId of validators) {
    const keyFile = `${vId.toLowerCase()}.key`;
    const csrFile = `${vId.toLowerCase()}.csr`;
    const crtFile = `${vId.toLowerCase()}.crt`;
    const extFile = `${vId.toLowerCase()}.ext`;

    const extContent = [
      'basicConstraints=CA:FALSE',
      'keyUsage=digitalSignature,keyEncipherment',
      'extendedKeyUsage=serverAuth,clientAuth',
      `subjectAltName=DNS:${vId}.pdschain.internal,DNS:localhost,IP:127.0.0.1`
    ].join('\n');

    fs.writeFileSync(path.join(tlsDir, extFile), extContent);

    runOpenssl(`req -newkey rsa:2048 -nodes -keyout ${keyFile} -out ${csrFile} -subj "/CN=${vId}/O=PDSChain Consortium"`);
    runOpenssl(`x509 -req -in ${csrFile} -CA ca.crt -CAkey ca.key -CAcreateserial -out ${crtFile} -days 365 -extfile ${extFile}`);

    try { fs.unlinkSync(path.join(tlsDir, csrFile)); } catch (e) {}
    try { fs.unlinkSync(path.join(tlsDir, extFile)); } catch (e) {}
  }

  // 3. Untrusted Alien CA and Certificate
  runOpenssl('req -x509 -newkey rsa:2048 -nodes -keyout alien-ca.key -out alien-ca.crt -subj "/CN=Alien Untrusted CA" -days 365');
  runOpenssl('req -newkey rsa:2048 -nodes -keyout alien-val.key -out alien-val.csr -subj "/CN=VAL-01/O=Alien Org"');
  runOpenssl('x509 -req -in alien-val.csr -CA alien-ca.crt -CAkey alien-ca.key -CAcreateserial -out alien-val.crt -days 365');
  try { fs.unlinkSync(path.join(tlsDir, 'alien-val.csr')); } catch (e) {}

  // 4. Wrong SAN (Subject = ATTACKER, SAN = DNS:attacker.com)
  const wrongExt = [
    'basicConstraints=CA:FALSE',
    'keyUsage=digitalSignature,keyEncipherment',
    'extendedKeyUsage=serverAuth,clientAuth',
    'subjectAltName=DNS:attacker.com'
  ].join('\n');
  fs.writeFileSync(path.join(tlsDir, 'wrong-san.ext'), wrongExt);
  runOpenssl('req -newkey rsa:2048 -nodes -keyout wrong-san.key -out wrong-san.csr -subj "/CN=ATTACKER/O=Adversary"');
  runOpenssl('x509 -req -in wrong-san.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out wrong-san.crt -days 365 -extfile wrong-san.ext');
  try { fs.unlinkSync(path.join(tlsDir, 'wrong-san.csr')); } catch (e) {}
  try { fs.unlinkSync(path.join(tlsDir, 'wrong-san.ext')); } catch (e) {}

  // 5. Expired Certificate (ended in 2021)
  const expiredExt = [
    'basicConstraints=CA:FALSE',
    'keyUsage=digitalSignature,keyEncipherment',
    'extendedKeyUsage=serverAuth,clientAuth',
    'subjectAltName=DNS:VAL-01.pdschain.internal,IP:127.0.0.1'
  ].join('\n');
  fs.writeFileSync(path.join(tlsDir, 'expired.ext'), expiredExt);
  runOpenssl('req -newkey rsa:2048 -nodes -keyout expired.key -out expired.csr -subj "/CN=VAL-01/O=PDSChain Consortium"');
  // Explicit past dates so the certificate is genuinely expired
  runOpenssl('x509 -req -in expired.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out expired.crt -not_before 20200101000000Z -not_after 20210101000000Z -extfile expired.ext');
  try { fs.unlinkSync(path.join(tlsDir, 'expired.csr')); } catch (e) {}
  try { fs.unlinkSync(path.join(tlsDir, 'expired.ext')); } catch (e) {}

  console.log('Phase 12 TLS Fixtures generated successfully!');
}

if (require.main === module) {
  generateAll();
}

module.exports = { generateAll };
