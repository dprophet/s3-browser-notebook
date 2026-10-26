S3_CONFIG ?= .secrets/credentials.json
PYTHON ?= python

# Everything the notebooks need. Marker files in .make/ keep repeat runs instant: the packages are
# reinstalled only when requirements.txt changes, and the Spark connector is downloaded once.
setup: setup-python setup-spark

setup-python: .make/python
.make/python: requirements.txt
	$(PYTHON) -m pip install -r requirements.txt
	-nbstripout --install
	@mkdir -p .make && touch $@

# The S3A connector for the PySpark notebook (~670 MB from Maven Central), into Spark's Ivy cache
setup-spark: .make/spark
.make/spark: .make/python scripts/prefetch-spark.py
	$(PYTHON) scripts/prefetch-spark.py
	@mkdir -p .make && touch $@

# JupyterLab on localhost only (Codespaces forwards the port for you). In a codespace it prints the
# forwarded https URL instead of 127.0.0.1; port_retries=0 keeps it on 8888 so that URL is right.
JUPYTER_PORT ?= 8888
ifdef CODESPACE_NAME
JUPYTER_URL := --ServerApp.custom_display_url=https://$(CODESPACE_NAME)-$(JUPYTER_PORT).$(GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN)
endif

jupyter: setup
	jupyter lab --no-browser --ip=127.0.0.1 --port=$(JUPYTER_PORT) --ServerApp.port_retries=0 $(JUPYTER_URL)

# Prints the export line for the config, base64-encoded. make can't set variables in your shell,
# so eval its output:   eval "$(make -s s3-env)"
# Another file:         eval "$(make -s s3-env S3_CONFIG=.secrets/other.json)"
s3-env:
	@test -f "$(S3_CONFIG)" || { echo "$(S3_CONFIG) not found" >&2; exit 1; }
	@printf 'export S3_ASSUMEROLE_CONFIG_B64=%s\n' "$$(base64 -w0 "$(S3_CONFIG)")"

.PHONY: setup setup-python setup-spark jupyter s3-env
