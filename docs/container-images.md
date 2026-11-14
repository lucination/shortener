# Container images

The image is published to `ghcr.io/OWNER/REPO`, using the repository name in
lowercase. Replace `OWNER/REPO` below with that lowercase name.

```sh
docker pull ghcr.io/OWNER/REPO:latest
# Optional: select a platform explicitly instead of using Docker's native default.
docker pull --platform linux/amd64 ghcr.io/OWNER/REPO:latest
docker pull --platform linux/arm64 ghcr.io/OWNER/REPO:latest
```

`latest` is one multi-platform image index containing native Linux amd64 and arm64
images. Successful releases also have a `sha-<full-40-character-commit-sha>` tag.
For a fixed artifact identity, use the published index digest:

```sh
docker pull ghcr.io/OWNER/REPO@sha256:INDEX_DIGEST
```

## Publication and checks

The **CI and container images** workflow runs on pull requests, pushes to `main`,
and manual **Run workflow** requests. Any selected manual branch is tested, but
only `main` can publish. Pull requests receive read-only repository access, do not
log into the registry, and cannot write packages. No personal access token or
additional repository secret is needed: trusted publication jobs use the built-in
`GITHUB_TOKEN` with `contents: read` and `packages: write`.

Before image jobs start, CI checks Rust formatting and tests with Rust 1.100.0,
compares the actual ts-rs export and its frontend copy, and installs, type-checks,
tests and builds the user SPA. It also installs, type-checks and builds the admin
SPA. Workflow policy and digest-validation tests run in the same gate.

Each architecture builds on its own native GitHub-hosted runner: `ubuntu-24.04`
for amd64 and `ubuntu-24.04-arm` for arm64. No CPU emulation is configured. These
labels are listed in GitHub's [hosted runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
Each image carries the repository source URL and commit revision labels.

Image jobs initially push only by digest, without moving any release tag. They
then pull and run that exact digest with random disposable runtime credentials,
a fresh SQLite volume, loopback-only SMTP, and a loopback-bound HTTP port. Checks
cover actual Docker HEALTHCHECK metadata and healthy → unhealthy → healthy states,
both SPA entry points, bundled JavaScript and fonts, the non-root user, writable
data directory and SQLite integrity. The fixture overrides the interval/start
period to 1 second and retries to 1, stops only the application with SIGSTOP (not
`docker pause`, which would also freeze probes), and always sends SIGCONT before
cleanup. Separate real-curl fixtures verify HTTP 200 acceptance and rejection of
204, redirects, errors, connection failures and timeouts, even with proxy variables
set. All checks use disposable UUID-named containers/volumes. No email is sent.

The runtime is pinned Alpine Linux with CA roots and curl. The genuine musl binary
statically links OpenSSL and bundled SQLite; the build rejects ELF dynamic-library
requirements. Node runs only on the build platform, and neither Node nor compilers
are in the runtime. Both native architectures use this same Dockerfile.

The quiet health probe requires a successful curl request **and exactly HTTP 200**
from `http://127.0.0.1:3000/_health`. It ignores curl configuration files, does not
follow redirects, bypasses proxy environment variables, allows only HTTP and
bounds the request to 3 seconds.
Defaults are interval 30 seconds, timeout 5 seconds, start period 10 seconds and
3 retries. Health status alone does not restart a Docker container; restart or
replacement policy is the operator's responsibility. The Buildx export uses Docker
media types so Docker/Podman clients retain the HEALTHCHECK configuration.

Only after **both** native smoke checks pass does a separate job accept exactly
two validated digest receipts. It creates and verifies the commit-tagged index,
checks its exact platform/digest pair, and then copies the verified index digest
to `latest`. Publication is serialized and checks the current `main` HEAD again
immediately before updating `latest`, so stale queued revisions are skipped.
Failed tests or either failed architecture leave `latest` unchanged. Digest-only
staging objects can remain after failed runs; they are not release tags.

## One-time package visibility setup

A newly published GitHub Container Registry package defaults to **private**, even
when its linked repository is public. Repository permission inheritance does not
make the package public. After the first successful publication, a package
administrator must open the package's **Package settings**, find **Change
visibility**, and choose **Public**. See GitHub's [package access and visibility
documentation](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility).

Until that step is complete, pulls require appropriate registry authentication.
Do not assume anonymous access because publication succeeded. Verify a pull with
an empty Docker credential directory after making the package public:

```sh
credentials=$(mktemp -d)
DOCKER_CONFIG="$credentials" docker pull ghcr.io/OWNER/REPO:latest
rm -rf "$credentials"
```

An existing package may also need its **Manage Actions access** settings to allow
this repository to write using `GITHUB_TOKEN`. Check repository Actions policy if
package publication is denied. The workflow does not change package visibility.
