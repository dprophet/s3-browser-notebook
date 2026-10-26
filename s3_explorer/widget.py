"""S3Explorer: a file explorer widget over one S3 credential.

The front end (explorer.js) sends one request per user action; each becomes plain S3 calls through
the session's boto3 client. Errors come back as data, so a refusal from the S3 endpoint shows up in the
explorer instead of as a traceback.
"""

import mimetypes
import posixpath
import tempfile
import uuid
import zipfile
from pathlib import Path

import anywidget
import traitlets
from botocore.exceptions import BotoCoreError, ClientError

HERE = Path(__file__).parent
CHUNK = 2 * 1024 * 1024                 # comm message size; Jupyter's websocket caps at 10 MiB
PREVIEW_BYTES = 1024 * 1024
PREVIEW_IMAGE_BYTES = 8 * 1024 * 1024
IMAGE_TYPES = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico"}


class OpError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


class S3Explorer(anywidget.AnyWidget):
    _esm = HERE / "explorer.js"
    _css = HERE / "explorer.css"

    bucket = traitlets.Unicode("").tag(sync=True)
    prefix = traitlets.Unicode("").tag(sync=True)
    buckets = traitlets.List(traitlets.Unicode()).tag(sync=True)     # suggestions for the bucket box
    cred = traitlets.Dict().tag(sync=True)
    height = traitlets.Int(600).tag(sync=True)

    def __init__(self, session, bucket, prefix="", buckets=(), **kwargs):
        super().__init__(bucket=bucket, prefix=prefix.strip("/") + "/" if prefix.strip("/") else "",
                         buckets=list(dict.fromkeys([bucket, *buckets])), **kwargs)
        self.session = session
        self._uploads = {}
        self.cred = session.status()
        self.on_msg(self._on_msg)

    # --- message plumbing --------------------------------------------------------------------

    def _on_msg(self, _widget, msg, buffers):
        if not isinstance(msg, dict) or "op" not in msg:
            return
        rid, op = msg.get("id"), msg["op"]
        handler = getattr(self, f"op_{op}", None)
        try:
            if handler is None:
                raise OpError("UnknownOp", f"Unknown operation {op!r}")
            result = handler(msg, buffers, rid) or {}
            out_buffers = result.pop("_buffers", None)
            self.send({"id": rid, "ok": True, "result": result}, out_buffers)
        except Exception as e:  # noqa: BLE001 — every failure goes back to the UI
            self.send({"id": rid, "ok": False, "error": describe(e)})

    def _progress(self, rid, buffers=None, **info):
        self.send({"id": rid, "progress": info}, buffers)

    @property
    def s3(self):
        # The header may be stale (e.g. session.sign_out() ran in another cell), so resend it
        if not self.session.creds:
            self.refresh_status()
            raise OpError("SignedOut", "Signed out. Click Sign in to get a new credential.")
        if self.session.expires_in <= 0:
            self.refresh_status()
            raise OpError("ExpiredToken", "The credential has expired. Renew it to carry on.")
        return self.session.client()

    def refresh_status(self):
        self.cred = self.session.status()

    # --- browsing ----------------------------------------------------------------------------

    def op_list(self, msg, _buffers, _rid):
        kwargs = {"Bucket": msg["bucket"], "Prefix": msg.get("prefix", ""), "Delimiter": "/", "MaxKeys": 1000}
        if msg.get("token"):
            kwargs["ContinuationToken"] = msg["token"]
        resp = self.s3.list_objects_v2(**kwargs)
        folders = [p["Prefix"] for p in resp.get("CommonPrefixes", [])]
        files = [{"key": o["Key"], "size": o["Size"], "modified": o["LastModified"].timestamp(),
                  "etag": o.get("ETag", "").strip('"'), "storage": o.get("StorageClass")}
                 for o in resp.get("Contents", []) if o["Key"] != kwargs["Prefix"]]   # skip folder marker
        return {"folders": folders, "files": files,
                "next_token": resp.get("NextContinuationToken") if resp.get("IsTruncated") else None}

    def op_head(self, msg, _buffers, _rid):
        h = self.s3.head_object(Bucket=msg["bucket"], Key=msg["key"])
        return {"size": h.get("ContentLength"), "content_type": h.get("ContentType"),
                "modified": h["LastModified"].timestamp() if h.get("LastModified") else None,
                "etag": h.get("ETag", "").strip('"'), "metadata": h.get("Metadata", {}),
                "storage": h.get("StorageClass"), "encryption": h.get("ServerSideEncryption")}

    def op_preview(self, msg, _buffers, _rid):
        key = msg["key"]
        limit = PREVIEW_IMAGE_BYTES if posixpath.splitext(key.lower())[1] in IMAGE_TYPES else PREVIEW_BYTES
        try:
            resp = self.s3.get_object(Bucket=msg["bucket"], Key=key, Range=f"bytes=0-{limit - 1}")
        except ClientError as e:
            if e.response["Error"].get("Code") != "InvalidRange":     # an empty object has no byte 0
                raise
            return {"content_type": guess_type(key), "size": 0, "truncated": False, "_buffers": [b""]}
        body = resp["Body"].read()
        content_range = resp.get("ContentRange") or ""               # "bytes 0-1023/5000"
        total = int(content_range.rsplit("/", 1)[1]) if content_range[-1:].isdigit() else len(body)
        return {"content_type": resp.get("ContentType") or guess_type(key), "size": total,
                "truncated": total > len(body), "_buffers": [body]}

    # --- download ----------------------------------------------------------------------------

    def op_download(self, msg, _buffers, rid):
        """One file streams as-is; several files or any folder stream as a zip."""
        bucket, keys, prefixes = msg["bucket"], msg.get("keys", []), msg.get("prefixes", [])
        if len(keys) == 1 and not prefixes:
            resp = self.s3.get_object(Bucket=bucket, Key=keys[0])
            size, sent = resp.get("ContentLength") or 0, 0
            for chunk in iter_chunks(resp["Body"]):
                sent += len(chunk)
                self._progress(rid, [chunk], sent=sent, total=size)
            return {"name": posixpath.basename(keys[0]), "content_type": resp.get("ContentType") or guess_type(keys[0]),
                    "size": sent}
        return self._download_zip(rid, bucket, keys, prefixes, msg.get("base", ""))

    def _download_zip(self, rid, bucket, keys, prefixes, base):
        members = [(k, None) for k in keys]
        for p in prefixes:
            members += [(o["Key"], o["Size"]) for o in self._walk(bucket, p) if not o["Key"].endswith("/")]
        with tempfile.TemporaryFile() as tmp:
            with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zf:
                for i, (key, _size) in enumerate(members, 1):
                    self._progress(rid, phase="zip", done=i - 1, count=len(members), key=key)
                    arcname = key[len(base):] if base and key.startswith(base) else key
                    body = self.s3.get_object(Bucket=bucket, Key=key)["Body"]
                    with zf.open(arcname, "w", force_zip64=True) as out:
                        for chunk in iter_chunks(body):
                            out.write(chunk)
            total, sent = tmp.tell(), 0
            tmp.seek(0)
            while chunk := tmp.read(CHUNK):
                sent += len(chunk)
                self._progress(rid, [chunk], sent=sent, total=total)
        stem = posixpath.basename((prefixes[0] if len(prefixes) == 1 and not keys else base).rstrip("/")) or bucket
        return {"name": f"{stem}.zip", "content_type": "application/zip", "size": total, "files": len(members)}

    # --- upload ------------------------------------------------------------------------------

    def op_upload_start(self, msg, _buffers, _rid):
        self.s3                                       # fail now, not after the bytes arrive
        uid = uuid.uuid4().hex
        self._uploads[uid] = {"bucket": msg["bucket"], "key": msg["key"], "size": msg.get("size", 0),
                              "type": msg.get("content_type") or guess_type(msg["key"]),
                              "file": tempfile.TemporaryFile(), "received": 0}
        return {"upload_id": uid, "chunk": CHUNK}

    def op_upload_chunk(self, msg, buffers, _rid):
        up = self._upload(msg)
        for b in buffers:
            up["file"].write(b)
            up["received"] += len(b)
        return {"received": up["received"]}

    def op_upload_finish(self, msg, _buffers, _rid):
        up = self._uploads.pop(msg["upload_id"], None)
        if up is None:
            raise OpError("NoSuchUpload", "Upload not found (was the kernel restarted?)")
        with up["file"] as f:
            f.seek(0)
            self.s3.upload_fileobj(f, up["bucket"], up["key"], ExtraArgs={"ContentType": up["type"]})
        return {"key": up["key"], "size": up["received"]}

    def op_upload_abort(self, msg, _buffers, _rid):
        up = self._uploads.pop(msg.get("upload_id"), None)
        if up:
            up["file"].close()

    def _upload(self, msg):
        try:
            return self._uploads[msg["upload_id"]]
        except KeyError:
            raise OpError("NoSuchUpload", "Upload not found (was the kernel restarted?)") from None

    # --- changes -----------------------------------------------------------------------------

    def op_mkdir(self, msg, _buffers, _rid):
        key = msg["prefix"].rstrip("/") + "/"
        self.s3.put_object(Bucket=msg["bucket"], Key=key, Body=b"")
        return {"prefix": key}

    def op_delete(self, msg, _buffers, rid):
        bucket = msg["bucket"]
        keys = list(msg.get("keys", []))
        for p in msg.get("prefixes", []):
            keys += [o["Key"] for o in self._walk(bucket, p)]
            keys.append(p)                            # the folder marker, if there is one
        deleted, errors = [], []
        for i, key in enumerate(dict.fromkeys(keys), 1):
            try:
                self.s3.delete_object(Bucket=bucket, Key=key)
                deleted.append(key)
            except ClientError as e:
                if not (key.endswith("/") and e.response["Error"].get("Code") in ("NoSuchKey", "404")):
                    errors.append({"key": key, **describe(e)})
            if i % 25 == 0:
                self._progress(rid, done=i, count=len(keys))
        return {"deleted": deleted, "errors": errors}

    def op_rename(self, msg, _buffers, rid):
        """Copy then delete. Folders move every object under them."""
        bucket, src, dst = msg["bucket"], msg["src"], msg["dst"]
        if src.endswith("/"):
            pairs = [(o["Key"], dst + o["Key"][len(src):]) for o in self._walk(bucket, src)]
        else:
            pairs = [(src, dst)]
        if not pairs:
            raise OpError("NoSuchKey", f"Nothing to move under {src}")
        for i, (s, d) in enumerate(pairs, 1):
            self._copy(bucket, s, d)
            self.s3.delete_object(Bucket=bucket, Key=s)
            self._progress(rid, done=i, count=len(pairs))
        return {"moved": len(pairs)}

    def _copy(self, bucket, src, dst):
        try:
            self.s3.copy({"Bucket": bucket, "Key": src}, bucket, dst)
        except ClientError as e:
            if e.response["Error"].get("Code") not in ("NotImplemented", "501"):
                raise
            # a proxy without CopyObject: stream it through the kernel instead
            with tempfile.TemporaryFile() as tmp:
                self.s3.download_fileobj(bucket, src, tmp)
                tmp.seek(0)
                self.s3.upload_fileobj(tmp, bucket, dst)

    def _walk(self, bucket, prefix):
        for page in self.s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
            yield from page.get("Contents", [])

    # --- credential --------------------------------------------------------------------------

    def op_status(self, _msg, _buffers, _rid):
        self.refresh_status()
        return self.cred

    def op_sign_out(self, _msg, _buffers, _rid):
        existed = self.session.sign_out()
        self.refresh_status()
        return {"was_cached": existed}

    def op_renew_start(self, _msg, _buffers, _rid):
        return self.session.login_start()

    def op_renew_poll(self, _msg, _buffers, _rid):
        state = self.session.login_poll()
        if state == "done":
            self.refresh_status()
        return {"state": state}


def iter_chunks(body):
    while chunk := body.read(CHUNK):
        yield chunk


def guess_type(key):
    return mimetypes.guess_type(key)[0] or "application/octet-stream"


def describe(e):
    """An exception as {code, message, status} for the UI."""
    if isinstance(e, ClientError):
        err, meta = e.response.get("Error", {}), e.response.get("ResponseMetadata", {})
        status = meta.get("HTTPStatusCode")
        code = err.get("Code") or str(status)
        message = err.get("Message") or {403: "Access denied", 404: "Not found"}.get(status, str(e))
        return {"code": code, "message": message, "status": status,
                "request_id": meta.get("RequestId") or meta.get("HTTPHeaders", {}).get("x-amz-request-id")}
    if isinstance(e, OpError):
        return {"code": e.code, "message": str(e)}
    if isinstance(e, BotoCoreError):
        return {"code": type(e).__name__, "message": str(e)}
    code = getattr(e, "code", None)
    return {"code": code if isinstance(code, str) else type(e).__name__,
            "message": getattr(e, "message", None) or str(e)}
