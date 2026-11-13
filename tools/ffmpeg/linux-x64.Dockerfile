# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
#
# The toolchain build-linux.sh compiles the linux-x64 FFmpeg in. Ubuntu 22.04 (glibc 2.35), so the result runs on
# 22.04 and later. The base is pinned by digest and every package comes from Ubuntu's snapshot archive at one instant
# (LINUX_APT_SNAPSHOT), so rebuilding this image installs the same package versions. build-linux.sh passes the three
# arguments from versions.env and names the image after them and this file; the build itself runs with no network.
#
# The base image has no CA certificates, so apt fetches the snapshot over HTTPS without checking the server's
# certificate. That costs no integrity: apt checks every index against the InRelease file signed with Ubuntu's archive
# key (ubuntu-keyring, in the base image) and every package against the index's SHA-256.
ARG LINUX_BASE_IMAGE
FROM ${LINUX_BASE_IMAGE}
ARG LINUX_APT_SNAPSHOT
ARG LINUX_APT_PACKAGES
RUN set -eu; \
    printf '%s\n' \
      'Acquire::Check-Valid-Until "false";' \
      'Acquire::https::Verify-Peer "false";' \
      'Acquire::https::Verify-Host "false";' \
      'Acquire::Retries "5";' \
      'APT::Install-Recommends "false";' \
      'APT::Install-Suggests "false";' > /etc/apt/apt.conf.d/99taalcut; \
    rm -f /etc/apt/sources.list.d/*; \
    for suite in jammy jammy-updates jammy-security; do \
      echo "deb https://snapshot.ubuntu.com/ubuntu/${LINUX_APT_SNAPSHOT} ${suite} main universe"; \
    done > /etc/apt/sources.list; \
    apt-get update; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y ${LINUX_APT_PACKAGES}; \
    dpkg-query -W -f '${Package}=${Version}\n' | LC_ALL=C sort > /toolchain-packages.txt; \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*.deb
