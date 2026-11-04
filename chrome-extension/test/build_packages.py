#!/usr/bin/env python3
"""Build local test packages for the Chrome and Firefox extension."""

import hashlib
import io
import struct
import subprocess
import tempfile
import zipfile
from pathlib import Path


EXTENSION_DIR = Path(__file__).resolve().parent.parent
TEST_DIR = Path(__file__).resolve().parent


def varint(value):
    encoded = bytearray()
    while value > 0x7F:
        encoded.append((value & 0x7F) | 0x80)
        value >>= 7
    encoded.append(value)
    return bytes(encoded)


def protobuf_bytes(field_number, value):
    return varint((field_number << 3) | 2) + varint(len(value)) + value


def extension_zip():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(EXTENSION_DIR.iterdir()):
            if path.is_file():
                archive.write(path, path.name)
    return buffer.getvalue()


def create_crx(zip_data):
    with tempfile.TemporaryDirectory(prefix="prayer-times-crx-") as temp_dir:
        temp = Path(temp_dir)
        key_path = temp / "test-key.pem"
        public_key_path = temp / "public-key.der"
        signed_data_path = temp / "signed-data"
        signature_path = temp / "signature"

        subprocess.run(
            [
                "openssl",
                "genpkey",
                "-algorithm",
                "RSA",
                "-pkeyopt",
                "rsa_keygen_bits:2048",
                "-out",
                str(key_path),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        subprocess.run(
            [
                "openssl",
                "pkey",
                "-in",
                str(key_path),
                "-pubout",
                "-outform",
                "DER",
                "-out",
                str(public_key_path),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )

        public_key = public_key_path.read_bytes()
        signed_header_data = protobuf_bytes(1, hashlib.sha256(public_key).digest()[:16])
        signed_data = (
            b"CRX3 SignedData\x00"
            + struct.pack("<I", len(signed_header_data))
            + signed_header_data
            + zip_data
        )
        signed_data_path.write_bytes(signed_data)
        subprocess.run(
            [
                "openssl",
                "dgst",
                "-sha256",
                "-sign",
                str(key_path),
                "-out",
                str(signature_path),
                str(signed_data_path),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )

        proof = protobuf_bytes(1, public_key) + protobuf_bytes(
            2, signature_path.read_bytes()
        )
        header = protobuf_bytes(1, signed_header_data) + protobuf_bytes(2, proof)
        return b"Cr24" + struct.pack("<II", 3, len(header)) + header + zip_data


def main():
    TEST_DIR.mkdir(parents=True, exist_ok=True)
    zip_data = extension_zip()
    (TEST_DIR / "PrayerTimes.xpi").write_bytes(zip_data)
    (TEST_DIR / "PrayerTimes.crx").write_bytes(create_crx(zip_data))
    print(f"Created test packages in {TEST_DIR}")


if __name__ == "__main__":
    main()
