"""A temporary S3 credential for one role: cached, issued by STS, renewable.

Sign-in is the OAuth 2.0 device authorization grant (RFC 8628) against an OpenID Connect provider,
whose endpoints come from its discovery document. The resulting token goes to STS
``AssumeRoleWithWebIdentity``, which returns a temporary credential for the S3 endpoint.

Everything environment-specific comes from one JSON config: the OAuth client (``client_id``, and
``client_secret`` if the provider requires one for the device grant) plus every URL, the role and
the bucket. It is read from
``$S3_ASSUMEROLE_CONFIG_B64`` (the JSON, base64-encoded) if set, otherwise from a file in
``.secrets/``. Its contents are never printed or put in an error message. The device login is
split into ``login_start`` / ``login_poll`` so the explorer widget can renew a credential without
blocking the kernel.

Every call — OIDC provider, STS and the S3 endpoint — goes direct, whatever ``https_proxy`` /
``no_proxy`` say: a TLS-intercepting proxy can drop the ``Range`` header, which breaks the
signature on ranged S3 GETs.
"""

import base64
import binascii
import json
import os
import time
import uuid
import webbrowser
import xml.etree.ElementTree as ET
from pathlib import Path

import boto3
import requests
from botocore.config import Config
from IPython.display import Markdown, display

from .cache import CredentialCache, jwt_claims

REQUIRED = ("client_id", "oidc_issuer", "sts_endpoint", "s3_endpoint", "role_arn", "bucket")
# provider_id: the ProviderId parameter of AssumeRoleWithWebIdentity, if your STS wants one.
# sts_via / s3_endpoint_via: a proxy for that one service. Missing or null means direct;
# http(s)_proxy from the environment is never used.
# ca_bundle: only for a service behind a proxy, which re-signs TLS with its own CA. Direct
# connections use the public CAs (certifi).
# maven_repository: where Spark downloads the S3A connector, if Maven Central isn't reachable.
OPTIONAL = {"provider_id": None, "extra_buckets": [], "sts_via": None, "s3_endpoint_via": None,
            "ca_bundle": "/etc/ssl/certs/ca-certificates.crt", "maven_repository": None}
STS_NS = {"sts": "https://sts.amazonaws.com/doc/2011-06-15/"}
CONFIG_ENV = "S3_ASSUMEROLE_CONFIG_B64"


class StsRefused(Exception):
    def __init__(self, code, message):
        super().__init__(f"{code}: {message}")
        self.code, self.message = code, message


def find_config(name, here=None):
    """``./.secrets/<name>`` first, then ``../.secrets/<name>`` (shared with a parent project)."""
    here = Path(here or Path.cwd())
    candidates = [here / ".secrets" / name, here.parent / ".secrets" / name]
    return next((p for p in candidates if p.is_file()), candidates[0])


def config_source(path):
    """Where the config comes from: the environment variable if it is set, otherwise the file."""
    return f"${CONFIG_ENV}" if os.environ.get(CONFIG_ENV) else str(path)


def read_config(path):
    """The raw config JSON, from $S3_ASSUMEROLE_CONFIG_B64 if set, otherwise the file.

    Errors name the source but never include its contents (the secret is in there).
    """
    raw = os.environ.get(CONFIG_ENV)
    if raw:
        try:
            return json.loads(base64.b64decode(raw.strip(), validate=True))
        except (binascii.Error, ValueError):
            raise ValueError(f"${CONFIG_ENV} is set but is not base64-encoded JSON") from None
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f"Config file not found: {path} (and ${CONFIG_ENV} is not set)")
    try:
        return json.loads(path.read_text())
    except ValueError:
        raise ValueError(f"{path} is not valid JSON") from None


def load_config(path):
    """The settings, without the client secret."""
    data = read_config(path)
    missing = [k for k in REQUIRED if not data.get(k)]
    if missing:
        raise ValueError(f"{config_source(path)} is missing {', '.join(missing)}")
    cfg = {k: data[k] for k in REQUIRED}
    cfg.update({k: data.get(k, default) for k, default in OPTIONAL.items()})
    cfg["env"] = tier(cfg["sts_endpoint"], cfg["s3_endpoint"])   # names the cache file and the badge
    return cfg


def tier(*urls):
    """ "dev", "alpha" or "beta" if any URL has .dev., .alpha. or .beta. in it, otherwise "prod"."""
    return next((t for t in ("dev", "alpha", "beta") if any(f".{t}." in u for u in urls)), "prod")


def client_auth(path):
    """The OAuth client fields for the device grant. client_secret is optional (RFC 8628 public
    clients have none); it is sent only if the config has one, as some providers require it."""
    data = read_config(path)
    auth = {"client_id": data["client_id"]}
    if data.get("client_secret"):
        auth["client_secret"] = data["client_secret"]
    return auth


class AssumeRoleSession:
    def __init__(self, config_file, cache=None):
        self.creds_file = Path(config_file)
        self.config_source = config_source(config_file)   # for display: never the contents
        self.cfg = load_config(config_file)
        self.env = self.cfg["env"]
        self.role_arn = self.cfg["role_arn"]
        self.cache = cache or CredentialCache()
        self.creds = None           # the cache entry in use
        self.source = None          # "cache" or "sts"
        self._device = None         # pending device login
        self._oidc = None           # the provider's discovery document
        self._client = None
        self.http = requests.Session()
        self.http.trust_env = False   # direct: ignore http(s)_proxy, no_proxy and REQUESTS_CA_BUNDLE

    def _route(self, via):
        """requests/botocore proxy and TLS settings for one service: direct, or through its proxy."""
        if not via:
            return {}, True
        return {"http": via, "https": via}, self.cfg["ca_bundle"]

    # --- credential --------------------------------------------------------------------------

    def load_cached(self):
        entry = self.cache.load(self.env, self.role_arn, self.cfg["sts_endpoint"])
        if entry:
            self._use(entry, "cache")
        return entry

    def sign_in(self, force=False):
        """Use the cached credential if it's still valid, otherwise log in and ask STS."""
        if not force and self.load_cached():
            return self.creds
        start = self.login_start()
        display(Markdown(f"### 👉 [Click here to sign in]({start['url']})\n\n"
                         f"Code: **`{start['user_code']}`** — waiting for you…"))
        try:
            webbrowser.open(start["url"])
        except webbrowser.Error:
            pass
        interval = start["interval"]
        while True:
            time.sleep(interval)
            state = self.login_poll()
            if state == "done":
                return self.creds
            if state == "slow_down":
                interval += 5

    def sign_out(self):
        self.creds = self._client = self.source = None
        return self.cache.clear(self.env, self.role_arn)

    def _issue(self, web_identity_token):
        creds = self.assume_role(web_identity_token)
        subject = (jwt_claims(web_identity_token) or {}).get("sub")
        self._use(self.cache.save(self.env, self.role_arn, self.cfg["sts_endpoint"], creds, subject=subject), "sts")
        return self.creds

    def _use(self, entry, source):
        self.creds, self.source, self._client = entry, source, None

    def assume_role(self, web_identity_token):
        """STS AssumeRoleWithWebIdentity: the provider's token in, a temporary credential out."""
        url = self.cfg["sts_endpoint"]
        form = {"Action": "AssumeRoleWithWebIdentity", "Version": "2011-06-15",
                "RoleArn": self.role_arn, "RoleSessionName": f"s3-explorer-{uuid.uuid4().hex[:8]}",
                "WebIdentityToken": web_identity_token, "DurationSeconds": "3600"}
        if self.cfg["provider_id"]:
            form["ProviderId"] = self.cfg["provider_id"]
        try:
            proxies, verify = self._route(self.cfg["sts_via"])
            resp = self.http.post(url, timeout=30, proxies=proxies, verify=verify, data=form)
        except requests.exceptions.ConnectionError as e:
            raise RuntimeError(f"Cannot reach STS at {url} ({type(e).__name__}).") from None
        try:
            root = ET.fromstring(resp.text)
        except ET.ParseError:
            raise StsRefused(f"HTTP {resp.status_code}", resp.text[:300]) from None
        if root.find(".//sts:Error", STS_NS) is not None or resp.status_code != 200:
            code = root.findtext(".//sts:Code", default=f"HTTP {resp.status_code}", namespaces=STS_NS)
            raise StsRefused(code, root.findtext(".//sts:Message", default="", namespaces=STS_NS))
        c = root.find(".//sts:Credentials", STS_NS)
        return {k: c.findtext(f"sts:{k}", namespaces=STS_NS)
                for k in ("AccessKeyId", "SecretAccessKey", "SessionToken", "Expiration")}

    @property
    def expires_in(self):
        return self.creds["expires_at"] - time.time() if self.creds else 0

    def status(self):
        """What the explorer shows in its header."""
        c = self.creds or {}
        return {"env": self.env, "role_arn": self.role_arn,
                "role": self.role_arn.split(":role/", 1)[-1], "signed_in": bool(self.creds),
                "expires_at": c.get("expires_at"), "issued_at": c.get("issued_at"),
                "subject": c.get("subject"), "source": self.source,
                "cache_file": str(self.cache.path(self.env, self.role_arn))}

    # --- device login (RFC 8628), in steps so the widget can renew without blocking ----------

    def oidc(self):
        """The provider's OpenID Connect discovery document (fetched once)."""
        if self._oidc is None:
            issuer = self.cfg["oidc_issuer"].rstrip("/")
            resp = self.http.get(f"{issuer}/.well-known/openid-configuration", timeout=15)
            resp.raise_for_status()
            self._oidc = resp.json()
            if not self._oidc.get("device_authorization_endpoint"):
                raise RuntimeError(f"{issuer} does not offer the device authorization grant")
        return self._oidc

    def login_start(self):
        auth = client_auth(self.creds_file)
        resp = self.http.post(self.oidc()["device_authorization_endpoint"], data={**auth, "scope": "openid"},
                              headers={"Accept": "application/json"}, timeout=15)
        resp.raise_for_status()
        dev = resp.json()
        self._device = {**dev, "auth": auth, "deadline": time.time() + int(dev.get("expires_in", 600))}
        url = dev.get("verification_uri_complete") or dev.get("verification_uri")
        return {"url": url, "user_code": dev.get("user_code"), "interval": int(dev.get("interval", 5))}

    def login_poll(self):
        """One token poll. Returns "pending", "slow_down" or "done"; raises on failure."""
        dev = self._device
        if not dev:
            raise RuntimeError("No sign-in in progress")
        if time.time() > dev["deadline"]:
            self._device = None
            raise TimeoutError("The sign-in link expired. Start again.")
        body = self.http.post(self.oidc()["token_endpoint"],
                              data={"grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                                    "device_code": dev["device_code"], **dev["auth"]},
                              headers={"Accept": "application/json"}, timeout=15).json()
        if "error" in body:
            if body["error"] in ("authorization_pending", "slow_down"):
                return "slow_down" if body["error"] == "slow_down" else "pending"
            self._device = None
            raise RuntimeError(f"Sign-in failed: {body.get('error_description') or body['error']}")
        self._device = None
        # The ID token carries the identity claims STS checks; fall back to the access token
        self._issue(body.get("id_token") or body["access_token"])
        return "done"

    # --- S3 ----------------------------------------------------------------------------------

    def client(self):
        """A standard boto3 S3 client on the current credential, pointed at the S3 endpoint."""
        if not self.creds:
            raise RuntimeError("Not signed in")
        if self._client is None:
            proxies, verify = self._route(self.cfg["s3_endpoint_via"])
            self._client = boto3.client(
                "s3", endpoint_url=self.cfg["s3_endpoint"], region_name="us-east-1",
                aws_access_key_id=self.creds["AccessKeyId"],
                aws_secret_access_key=self.creds["SecretAccessKey"],
                aws_session_token=self.creds["SessionToken"],
                verify=verify,
                # {} rather than None stops botocore falling back to https_proxy
                config=Config(signature_version="s3v4", s3={"addressing_style": "path"},
                              retries={"max_attempts": 2, "mode": "standard"}, proxies=proxies))
        return self._client


def show_sign_in(session):
    """Notebook-friendly sign-in: says whether the cache was used and when the credential expires."""
    session.sign_in()
    mins = int(session.expires_in // 60)
    until = time.strftime("%H:%M", time.localtime(session.creds["expires_at"]))
    how = ("Reused the cached credential, so no sign-in was needed." if session.source == "cache"
           else "Signed in and got a new credential from STS. It's cached until it expires.")
    display(Markdown(f"✅ **{how}**\n\n"
                     f"`{session.role_arn}` · valid until **{until}** ({mins} min)  \n"
                     f"Cache: `{session.cache.path(session.env, session.role_arn)}`"))
