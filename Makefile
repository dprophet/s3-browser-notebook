S3_CONFIG ?= .secrets/credentials.json

install:
	python -m pip install -r requirements.txt
	nbstripout --install

# JupyterLab on localhost only (Codespaces forwards the port for you)
jupyter:
	jupyter lab --no-browser --ip=127.0.0.1 --port=8888

# Prints the export line for the config, base64-encoded. make can't set variables in your shell,
# so eval its output:   eval "$(make -s s3-env)"
# Another file:         eval "$(make -s s3-env S3_CONFIG=.secrets/other.json)"
s3-env:
	@test -f "$(S3_CONFIG)" || { echo "$(S3_CONFIG) not found" >&2; exit 1; }
	@printf 'export S3_ASSUMEROLE_CONFIG_B64=%s\n' "$$(base64 -w0 "$(S3_CONFIG)")"

.PHONY: install jupyter s3-env
