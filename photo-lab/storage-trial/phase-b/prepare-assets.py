#!/usr/bin/env python3
"""Copy only checksum-verified v4 codec/fixtures; no downloads or deployment."""
import hashlib,pathlib
p=pathlib.Path(__file__).resolve().parent
source=p.parents[1]/'hosted-v4-transfer'/'extracted'/'source'
files={'codec.js':'75a280f9a74ad26420d10cb68d8bbea9689e31b2e6bf6d2cd58c45aacdc27ab2','fixtures.js':'bda03b92994e8d381ef70a559bf7bb54423cdd9ca518d904cf3cd0ba04b0d629'}
for name,digest in files.items():
 data=(source/name).read_bytes();assert hashlib.sha256(data).hexdigest()==digest; (p/name).write_bytes(data)
for name in ['LICENSE','LICENSE.codec.md']:(p/name).write_bytes((source/name).read_bytes())
print('Approved v4 codec and fixtures copied; checksums match.')
