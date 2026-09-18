const net = require('net');
const tls = require('tls');
const logger = require('../utils/logger');
const { NetworkErrorCode, NetworkError } = require('./NetworkErrors');

// Valid RFC-compliant self-signed 2048-bit RSA certificate and private key for PDSChain Dev
const STATIC_DEV_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCltSyfxRX8WLpD
bg9eVI+iXQJ1lvtNJNKnoYpaV6LSR0N8Is8BGli4vZib7avPU6t7dQNTvh+F+DpV
0uJ5Rx+P3N3tSKmnuZ5IvBBOvfEJCGaSsNgMpvdGXE/eiqpx7YP4nRhhMr4NOL3+
EFLerKa6dArkgwcq5BMxhO3xbRP2xekKBUuVFg0KABivbnhRRxeWjislKFjtsGTF
UYWlQAMKZWAcUkvB7PhbSMRDxsScOkxRzp0MvrW9S4S7eqgS5xkCEqLooOhPnc66
MeSlnEIIwdBkvRNv/hxyR9nXRWuSfMj1wS6+4RcROevcSSWq6yWjihmEGS0YQlfR
ifg2uEW5AgMBAAECggEACrK4cOUuuZtkhRtwgxDMXXlfQgZkxDLTJc7m/tT8a6fS
/8tDLYlM/o+rsATHYZZ/h57YP4+9UG8kRwEF2DoYW8zw3VOiXl7Rt6o/7EbU2QDc
QcQIjW05zCaut7RLSO6CZWqGVdTKknxzaa5rRznYIXQB9bBO5hI8+fwLckQuSdwb
reEklGKqbug/SNkce35c0BJTAgnXeMkgxythDcPaS/thWN0Juftwz7OlEBFJUqj4
jMonsnPUJKp2AHQSeWp7E2Q+XrsmaABMj4d8uA9XixR3V3OqK5M9v+HDIA+MJpwu
6VuVLwG0Jixmx5/D3UWhhtPHh6OO0XezTSuj3qp9jQKBgQDX2OuMP5skIl++lOAz
QX6bZzwe9Kr9ZjCj2XUroeUNBqH/2Pfi9q+FnLUhw1YiRgeoNkde5r7y1xTpC3QZ
wvg4kzVTD4pl0t38GiQn4ATyTulqFFfv3bmYAqaDyUxfWqa4j+98+dht2/RJUwH5
cdjLqe6ovEw77R9LB9w3XM3gjQKBgQDEiIFUJfbQYsw7PZloZ7XzwD71aaaBTToh
DiMeT8ITxyB6TPXOD/AcUfQUBpfEXmYJfhAQi/KgRAjWHCcm75Evkhqu21xVc+DE
0LoKGpyIpn+WtSKFY0LMa0NaFr7ijRjikWxRAynrQucUQhThBggDJ0jml8jrzV5o
qrQzHaYc3QKBgQCaG2b5aERVBTHEuThlgAJr48YZ9+fJKdfadBzi/SCzLyQkrf02
D5h71cnBBF0P9V3sLGzChg6ZBRUJ2kKXTgu5IOk2l2bhki8pmmRsD9aYRd0C/ulV
+cFTlbjbaLJddjSIm0OKwDtVHHCKlXhYZ3840efykxX+xyrLgB4rbNgU1QKBgCyI
SdXJbG23lVNvF83CgkYjL6DoOaRe3WcUDv0VUYKtwjw0KBZzIhMotse63rTONwy7
leRJ8cZC5EWvx2dZLWq8DnPEnN14DlxKd31GnmWQZKS/knzrCv3K6E4HjWVEV3kv
Pn3025DFbhr3Bkge173vLuOhTROxS00oMQDMHRG5AoGBAJnURebNOmamJ+XXtq2b
ozpIhTH0r+Lm1n3u8luTu4h5FmWNlWXC/h7GdOvrbuYRj2DExvLGYbV9XubPc3dG
TMUdSB3WYFMxoi9coXtixtipp6kWWUX0PBpGKFUChchUOGS0bPv+cUBMBtyYCAqd
8ClA43g1+gqlLqjsG7ndLwpJ
-----END PRIVATE KEY-----`;

const STATIC_DEV_CERT = `-----BEGIN CERTIFICATE-----
MIIDGzCCAgOgAwIBAgIUGqaezscJSNWpg/gbywh1MwglJD4wDQYJKoZIhvcNAQEL
BQAwHTEbMBkGA1UEAwwScGRzY2hhaW4tdmFsaWRhdG9yMB4XDTI2MDkxNzA4MjQx
OVoXDTM2MDkxNDA4MjQxOVowHTEbMBkGA1UEAwwScGRzY2hhaW4tdmFsaWRhdG9y
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEApbUsn8UV/Fi6Q24PXlSP
ol0CdZb7TSTSp6GKWlei0kdDfCLPARpYuL2Ym+2rz1Ore3UDU74fhfg6VdLieUcf
j9zd7Uipp7meSLwQTr3xCQhmkrDYDKb3RlxP3oqqce2D+J0YYTK+DTi9/hBS3qym
unQK5IMHKuQTMYTt8W0T9sXpCgVLlRYNCgAYr254UUcXlo4rJShY7bBkxVGFpUAD
CmVgHFJLwez4W0jEQ8bEnDpMUc6dDL61vUuEu3qoEucZAhKi6KDoT53OujHkpZxC
CMHQZL0Tb/4cckfZ10VrknzI9cEuvuEXETnr3Eklquslo4oZhBktGEJX0Yn4NrhF
uQIDAQABo1MwUTAdBgNVHQ4EFgQU6qyUle6r5CA7xhZbNNI6EhIu9eUwHwYDVR0j
BBgwFoAU6qyUle6r5CA7xhZbNNI6EhIu9eUwDwYDVR0TAQH/BAUwAwEB/zANBgkq
hkiG9w0BAQsFAAOCAQEAmaPtEXig2jRuAANXzAo7+yHDo9gQNRx3PeGtdPLn9qLm
KdBcy2UFa5ys6WgfvuMV2fXTfjwMyuDt0zuwuCvJY4ZImcuc0HOZwDXqA5jCW1Zg
0UHo0MmRq7LgLpxanHZ4TDICbvBHSnC3FYQRyWfpl/DHH1GA6fLR1xl0OcTUUAfy
q7I+i9aFuoVYaMG+Bk/+xGfeKodOAj4IlKD1YqERU4OBYoUXHz+RhsANPTGap0cC
rPi33Up9l7Gudq19cOTwZNXBtyHDjjBswbPb7X99gA7CYj+mEha3ffyXzhC4xtn/
2Bt9ge2dzzeC0LSMfiBz+5Mbi0ia+Wd3CVoCsYDeiw==
-----END CERTIFICATE-----`;

function getDevTLSCredentials() {
  return {
    key: STATIC_DEV_KEY,
    cert: STATIC_DEV_CERT
  };
}

class TLSTransport {
  /**
   * Static factory to create a listening TLS/TCP server
   * @param {number} port
   * @param {string} host
   * @param {object} options
   * @param {boolean} [options.tls=true]
   * @param {object} [options.tlsOptions]
   * @param {function} options.onConnection - Callback(socket)
   * @returns {Promise<net.Server|tls.Server>}
   */
  static async createServer(port, host = '127.0.0.1', options = {}) {
    return new Promise((resolve, reject) => {
      const useTLS = options.tls !== false && options.useTLS !== false;
      const onConnection = options.onConnection || (() => {});
      let server;

      if (useTLS) {
        const tlsOpts = options.tlsOptions || {};
        const creds = tlsOpts.key && tlsOpts.cert
          ? tlsOpts
          : getDevTLSCredentials();

        const ca = tlsOpts.ca || options.ca;
        const requestCert = tlsOpts.requestCert !== undefined 
          ? tlsOpts.requestCert 
          : (options.requestCert !== undefined ? options.requestCert : Boolean(ca || tlsOpts.mTLS || options.mTLS));
        const rejectUnauthorized = tlsOpts.rejectUnauthorized !== undefined
          ? tlsOpts.rejectUnauthorized
          : (options.rejectUnauthorized !== undefined ? options.rejectUnauthorized : false);

        const tlsServerOptions = {
          key: creds.key,
          cert: creds.cert,
          requestCert,
          rejectUnauthorized
        };
        if (ca) {
          tlsServerOptions.ca = ca;
        }

        server = tls.createServer(tlsServerOptions, (socket) => {
          onConnection(socket, true);
        });
      } else {
        server = net.createServer((socket) => {
          onConnection(socket, true);
        });
      }

      server.on('error', (err) => {
        reject(new NetworkError(NetworkErrorCode.CONNECTION_TIMEOUT, `Transport server error: ${err.message}`));
      });

      server.listen(port, host, () => {
        resolve(server);
      });
    });
  }

  /**
   * Static factory to connect to a remote TLS/TCP endpoint
   * @param {number} port
   * @param {string} host
   * @param {object} options
   * @param {boolean} [options.tls=true]
   * @param {number} [options.timeoutMs=5000]
   * @returns {Promise<net.Socket|tls.TLSSocket>}
   */
  static async connect(port, host = '127.0.0.1', options = {}) {
    return new Promise((resolve, reject) => {
      const useTLS = options.tls !== false && options.useTLS !== false;
      const timeout = options.timeoutMs || 5000;
      let socket;

      let timer = setTimeout(() => {
        if (socket) socket.destroy();
        reject(new NetworkError(NetworkErrorCode.CONNECTION_TIMEOUT, `Connection to ${host}:${port} timed out after ${timeout}ms`));
      }, timeout);

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      };

      if (useTLS) {
        const tlsOpts = options.tlsOptions || {};
        const ca = tlsOpts.ca || options.ca;
        const key = tlsOpts.key || options.key;
        const cert = tlsOpts.cert || options.cert;
        const rejectUnauthorized = tlsOpts.rejectUnauthorized !== undefined 
          ? tlsOpts.rejectUnauthorized 
          : (options.rejectUnauthorized !== undefined ? options.rejectUnauthorized : false);

        const connectOptions = {
          host,
          port,
          rejectUnauthorized
        };
        if (key) connectOptions.key = key;
        if (cert) connectOptions.cert = cert;
        if (ca) connectOptions.ca = ca;
        if (tlsOpts.checkServerIdentity !== undefined) {
          connectOptions.checkServerIdentity = tlsOpts.checkServerIdentity;
        } else if (options.checkServerIdentity !== undefined) {
          connectOptions.checkServerIdentity = options.checkServerIdentity;
        } else if (!rejectUnauthorized) {
          connectOptions.checkServerIdentity = () => undefined;
        }

        socket = tls.connect(connectOptions, () => {
          cleanup();
          resolve(socket);
        });
      } else {
        socket = net.connect({ host, port }, () => {
          cleanup();
          resolve(socket);
        });
      }

      socket.once('error', (err) => {
        cleanup();
        reject(new NetworkError(NetworkErrorCode.CONNECTION_TIMEOUT, `Failed to connect to ${host}:${port}: ${err.message}`));
      });
    });
  }

  /**
   * Static helper to close a server
   * @param {net.Server|tls.Server} server 
   */
  static async closeServer(server) {
    return new Promise((resolve) => {
      if (server && server.listening) {
        server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  /**
   * Instance-based constructor
   * @param {NetworkConfig} config
   */
  constructor(config) {
    this.config = config;
    this.server = null;
    this.isListening = false;
  }

  async listen(onConnection) {
    this.server = await TLSTransport.createServer(
      this.config.listenPort,
      this.config.listenHost,
      {
        tls: this.config.tls,
        tlsOptions: this.config.tlsOptions,
        onConnection
      }
    );
    this.isListening = true;
    return this.server.address().port;
  }

  async connect(host, port) {
    return TLSTransport.connect(port, host, {
      tls: this.config.tls,
      tlsOptions: this.config.tlsOptions,
      timeoutMs: this.config.connectionTimeoutMs
    });
  }

  async close() {
    if (this.server) {
      await TLSTransport.closeServer(this.server);
      this.server = null;
      this.isListening = false;
    }
  }
}

module.exports = TLSTransport;
module.exports.TLSTransport = TLSTransport;
module.exports.getDevTLSCredentials = getDevTLSCredentials;

