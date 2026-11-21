# certs/ (git-ignored)

Put the AWS IoT files here (already done in this package):

| File | What it is |
|---|---|
| `AmazonRootCA1.pem` | Amazon root CA (RSA) - used to verify the AWS IoT endpoint |
| `AmazonRootCA3.pem` | Amazon root CA (ECC) - not needed with an RSA certificate, kept for reference |
| `device-certificate.pem.crt` | this thing's certificate |
| `device-private.pem.key` | its private key - keep secret, never commit |
| `device-public.pem.key` | its public key - not used by the backend |

Everything in this folder except this README is ignored by git.
