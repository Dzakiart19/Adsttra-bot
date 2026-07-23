#!/usr/bin/env bash
# Auto-generated oleh install.sh
# Jalankan bot dengan library path yang benar

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export LD_LIBRARY_PATH="/nix/store/24w3s75aa2lrvvxsybficn8y3zxd27kp-mesa-libgbm-25.1.0/lib:/nix/store/0iqri8mm7vqnf7vr0bm8qkbak2g18q1x-systemd-minimal-libs-255.6-dev/lib:/nix/store/01p6q379ph9iwjwy3svdm59yw45mn6w6-libxkbcommon-0.7.2-dev/lib:/nix/store/00bywbidfprrn50vrlzm58lq4i3h7fnh-at-spi2-core-2.50.2/lib:/nix/store/02b1r3a635n2lfnwn7zr3i48aidvp501-cups-2.3.3/lib:/nix/store/0schwghhdnmchwc180r5b85r1xrwlv93-nspr-4.35-dev/lib:/nix/store/099d1r004qn5jpbmkhphgzx88jfx74w7-nss-mdns-0.15.1/lib:/nix/store/0g7r7krqiz6g3nb3651sfa5myd9gqkzf-alsa-lib-1.2.11/lib:/nix/store/00djx2bqz895ddac2jgqg8sa7hi5a3w8-gi-cairo-1.0.26/lib:/nix/store/070s6fml7n4g0c2n32bzydc06955b6ab-expat-2.7.1/lib:/nix/store/00y6vbsqqn20vdh2y5w36cj5p8nr5cw2-chicken-dbus-0.97/lib:/nix/store/01m7xfwkalqini87gjv37d7gq2qaiz8b-freetype-2.10.4/lib:/nix/store/0gxrwp9xnzb5li8i7w3q7qmm0lm808qq-libX11-1.8.9-dev/lib:/nix/store/09aq563zkqcw9ikxn02p4bm13i2hz51r-libxcb-1.17.0/lib:/nix/store/0lvg7w3z2dgsizdf8m23vgi1vgs4fki3-libXcomposite-0.4.6-dev/lib:/nix/store/05m5r0rhjj590x8npy5syc8sc0qzhf2s-libXcursor-1.2.0-dev/lib:/nix/store/120iznmgwcdf1a8bdnn69csyqs2i684f-libXdamage-1.1.6-dev/lib:/nix/store/0046rn5sgi6l38zl81bg2r02zlzxqqbc-libXext-1.3.6/lib:/nix/store/176zb6rql061hawvybln7xn8c73jjbp4-libXfixes-6.0.1/lib:/nix/store/0mkmwjz3gnnsnw1d1ch1cdy4qkxwp15j-libXi-1.8-dev/lib:/nix/store/0dc3l2207a676x11asvq56lz2sin9jc5-libXrandr-1.5.2-dev/lib:/nix/store/0j5kn0y8w955spfjjkz4h82q6jdn387b-libXrender-0.9.10/lib:/nix/store/1dpwfla39ap6nsj6v8xj9s8vp5nv3cpv-libXScrnSaver-1.2.4/lib:/nix/store/005b9zpxxpx79g324amq1hrq3db0daky-libXtst-1.2.3/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

exec node dist/main.js "$@"
