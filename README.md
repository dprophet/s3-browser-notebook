# S3 Browser Notebook

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/dprophet/s3-browser-notebook)
[![Binder](https://mybinder.org/badge_logo.svg)](https://mybinder.org/v2/gh/dprophet/s3-browser-notebook/HEAD?urlpath=lab/tree/s3-browser-demo.ipynb)

A file explorer for an S3 bucket, running in a Jupyter notebook, plus two notebooks that do the
same things from code. Sign in with an OpenID Connect provider (OAuth 2.0 device flow), exchange
the token for a temporary credential with STS `AssumeRoleWithWebIdentity`, then use any S3
endpoint that accepts it.

```
 you ──sign in──▶ OIDC provider ──ID token──▶ STS ──▶ temporary credential (1 hour, one role)
                                                          │
                                                          ▼
                                               any standard S3 client ──▶ S3 endpoint
```

| Notebook | What it shows |
| --- | --- |
| [`s3-browser-demo.ipynb`](s3-browser-demo.ipynb) | The S3 explorer: folders, breadcrumbs, preview (CSV, JSON, text, images, PDF), drag-and-drop upload of files and folders, download (several files or a folder as one zip), rename, delete, copy URI. The credential is cached until it expires, and **Renew** signs you in again in place. |
| [`s3-boto3-demo.ipynb`](s3-boto3-demo.ipynb) | For engineers, in boto3: sign in, inspect the credential, connect (every client setting spelled out), round-trip an object, write a dataset as CSV and partitioned Parquet, read it back and query it, see what the role refuses, clean up. |
| [`s3-pyspark-demo.ipynb`](s3-pyspark-demo.ipynb) | The same steps, data and results as the boto3 notebook, in PySpark through Hadoop's S3A connector. |

All three read the same config and share the credential cache (`~/.cache/s3-assumerole/`), so one
sign-in covers them. The two engineer notebooks are self-contained; the explorer's code is in
[`s3_explorer/`](s3_explorer).

## What you need

- An **OAuth client** at your OpenID Connect provider that may use the device authorization grant
  (RFC 8628). Ideally a public client: it has no secret, so it cannot use the client-credentials
  grant.
- An **STS** that accepts the provider's tokens in `AssumeRoleWithWebIdentity`, and a **role** that
  can reach your bucket.
- An **S3 endpoint** that accepts the temporary credential.
- Network access from wherever the notebook runs to the provider, STS and the S3 endpoint. The
  notebooks connect directly and ignore `http_proxy`/`https_proxy`.

## Config

One JSON file, `.secrets/credentials.json` (`.secrets/` is gitignored). Start from the example:

```bash
mkdir -p .secrets
cp credentials.example.json .secrets/credentials.json
chmod 600 .secrets/credentials.json
```

| Key | |
| --- | --- |
| `client_id` | Your OAuth client at the OpenID Connect provider |
| `client_secret` | Only if your provider requires one for the device grant; delete the line for a public client |
| `oidc_issuer` | The provider's issuer URL; endpoints come from its `/.well-known/openid-configuration` |
| `sts_endpoint` | The STS that accepts the provider's tokens in `AssumeRoleWithWebIdentity` |
| `s3_endpoint` | The S3 endpoint |
| `role_arn` | The full ARN of the role to assume, sent to STS as is |
| `bucket` | The bucket the notebooks use |

Optional: `provider_id` (the `ProviderId` parameter of `AssumeRoleWithWebIdentity`, if your STS wants
one), `extra_buckets` (more buckets to offer in the explorer) and `maven_repository` (a Maven mirror
for the PySpark notebook, if Maven Central isn't reachable).

Instead of the file, the same JSON can be passed base64-encoded in the environment variable
`S3_ASSUMEROLE_CONFIG_B64`; when it is set it wins over the file. The notebooks never print the
config.

## Run it

### GitHub Codespaces

1. Optional: add a Codespaces secret named `S3_ASSUMEROLE_CONFIG_B64` with the output of
   `base64 -w0 credentials.json` (repository or user settings → Codespaces → secrets). The
   codespace offers to set it when you create one.
2. Click **Open in GitHub Codespaces** above. The container installs the requirements and Java.
3. Without the secret, create `.secrets/credentials.json` in the codespace (see [Config](#config)).
4. Open a notebook in VS Code and pick the Python 3.12 kernel, or run `make jupyter` and open the
   forwarded port 8888 for JupyterLab.

### Binder

Click **Binder** above; it opens the S3 explorer in JupyterLab. Then upload your config to
`.secrets/credentials.json` with JupyterLab's file browser.

mybinder.org runs on shared public infrastructure, and the session (with your upload) is deleted
when it ends. Prefer a public OAuth client there, so the config holds no secret, and only use it if
your provider, STS and S3 endpoint are reachable from the internet.

### Locally

```bash
python3 -m venv .venv
source .venv/bin/activate
make install          # pip install -r requirements.txt && nbstripout --install
make jupyter
```

The PySpark notebook needs Java 17 or newer. To pass the config as the environment variable instead
of the file: `eval "$(make -s s3-env)"` before `make jupyter`.

In every case: open a notebook, **Run → Run All Cells**, and approve the sign-in in the browser tab
it opens (the link is shown in the notebook too), unless a cached credential is still valid.

## How it works

- **Sign-in** is the OAuth 2.0 device authorization grant. The notebook shows a link and a code,
  you approve it in any browser, and the provider returns an ID token. `client_secret` is sent only
  if the config has one.
- **STS** `AssumeRoleWithWebIdentity` exchanges that token for an access key, secret key and
  session token for `role_arn`, valid for an hour.
- **Cache**: the credential is kept in `~/.cache/s3-assumerole/` (directory 0700, file 0600) until
  the session token's JWT `exp`, so re-running a notebook or restarting the kernel skips the
  sign-in. The engineer notebooks only reuse a credential with at least 15 minutes left.
- **Direct connections**: a TLS-intercepting proxy can drop the `Range` header, which breaks the
  signature on ranged S3 GETs (file previews, Spark reads), so the notebooks never use one.
- **PySpark** uses `hadoop-aws` 3.5.0 (matching PySpark 4.2) with
  `TemporaryAWSCredentialsProvider`, path-style access, and single-object deletes for S3 endpoints
  that refuse the bulk `DeleteObjects` call.

## Contributing

Run `nbstripout --install` (or `make install`) before your first commit. Cell outputs contain
sign-in claims and bucket listings; the `.gitattributes` filter strips them on commit, but git
silently skips a filter that isn't configured in your clone.

## License

[Apache License 2.0](LICENSE)
