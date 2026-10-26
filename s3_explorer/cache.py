"""Local cache for STS credentials, valid until the session token's own expiry.

The STS session token is a JWT. Its ``exp`` claim is when the S3 endpoint stops accepting it, so
that is how long the cache keeps it. One file per environment and role, readable only by you (0600) in a
directory only you can enter (0700).
"""

import base64
import json
import os
import re
import time
from datetime import datetime
from pathlib import Path

DEFAULT_DIR = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "s3-assumerole"

# A credential this close to expiry is treated as expired, so a request never starts on a token
# that dies in flight.
EXPIRY_MARGIN_SECONDS = 60


def jwt_claims(token):
    """A JWT's claims, or None if the token isn't a JWT. Does NOT verify the signature."""
    parts = (token or "").split(".")
    if len(parts) != 3:
        return None
    try:
        return json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
    except ValueError:
        return None


def expires_at(creds):
    """Epoch seconds when the credential stops working: the JWT ``exp``, else STS ``Expiration``."""
    candidates = []
    claims = jwt_claims(creds.get("SessionToken"))
    if claims and isinstance(claims.get("exp"), (int, float)):
        candidates.append(float(claims["exp"]))
    if creds.get("Expiration"):
        try:
            candidates.append(datetime.fromisoformat(creds["Expiration"].replace("Z", "+00:00")).timestamp())
        except ValueError:
            pass
    if not candidates:
        raise ValueError("Credential has neither a JWT exp claim nor an Expiration")
    return min(candidates)


class CredentialCache:
    def __init__(self, directory=DEFAULT_DIR):
        self.directory = Path(directory)

    def path(self, env, role_arn):
        slug = re.sub(r"[^A-Za-z0-9_.-]+", "_", role_arn.split("role/", 1)[-1])
        return self.directory / f"sts-{env}-{slug}.json"

    def load(self, env, role_arn, endpoint):
        """The cached credential for this env/role/STS endpoint, or None if absent or expired."""
        path = self.path(env, role_arn)
        try:
            entry = json.loads(path.read_text())
        except (OSError, ValueError):
            return None
        if entry.get("role_arn") != role_arn or entry.get("sts_endpoint") != endpoint:
            return None
        if entry.get("expires_at", 0) - EXPIRY_MARGIN_SECONDS <= time.time():
            path.unlink(missing_ok=True)
            return None
        return entry

    def save(self, env, role_arn, endpoint, creds, **extra):
        entry = {**creds, **extra, "env": env, "role_arn": role_arn, "sts_endpoint": endpoint,
                 "issued_at": time.time(), "expires_at": expires_at(creds)}
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.directory, 0o700)
        path = self.path(env, role_arn)
        tmp = path.with_suffix(f".{os.getpid()}.tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(entry, f)
        os.replace(tmp, path)
        return entry

    def clear(self, env, role_arn):
        path = self.path(env, role_arn)
        existed = path.exists()
        path.unlink(missing_ok=True)
        return existed
