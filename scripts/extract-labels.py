#!/usr/bin/env python3
"""
Extract ground-truth playing-surface corners from the hand-labelled felt masks
in train-dataset/ into train-dataset/labels.json — the real-geometry fixture the
rail-fit bench (railLines.bench.test.ts) runs against.

Each `<id>.mask.png` is a filled convex quad (the labelled playing surface). We
decode it, take the white region's convex hull, pick the 4 hull vertices of
maximum enclosed area (the true corners), and order them TL,TR,BR,BL clockwise —
the same convention the detectors output.

Decoding without a Python image lib: macOS `sips` converts PNG → BMP, which
numpy reads directly. Host-only prep step; the bench consumes the JSON, so tests
stay dependency-free and reproducible.

Run:  python3 scripts/extract-labels.py
"""
import numpy as np, struct, glob, os, json, itertools, subprocess, tempfile, math


def read_mask(png):
    """PNG → boolean white-mask array + (w, h), via sips→BMP→numpy."""
    bmp = tempfile.mktemp(suffix=".bmp")
    subprocess.run(["sips", "-s", "format", "bmp", png, "--out", bmp],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    b = open(bmp, "rb").read()
    os.remove(bmp)
    off = struct.unpack_from("<I", b, 10)[0]
    w = struct.unpack_from("<i", b, 18)[0]
    h = struct.unpack_from("<i", b, 22)[0]
    bpp = struct.unpack_from("<H", b, 28)[0]
    rb = ((bpp * w + 31) // 32) * 4  # rows padded to 4 bytes
    ch = bpp // 8
    img = np.frombuffer(b, np.uint8, count=rb * abs(h), offset=off) \
        .reshape(abs(h), rb)[:, : w * ch].reshape(abs(h), w, ch)
    if h > 0:  # positive height = bottom-up
        img = img[::-1]
    return (img[:, :, 0] > 127), w, abs(h)


def hull(pts):
    """Andrew's monotone-chain convex hull; pts = list of (x,y)."""
    pts = sorted(set(map(tuple, pts)))

    def half(ps):
        r = []
        for p in ps:
            while len(r) >= 2 and (r[-1][0] - r[-2][0]) * (p[1] - r[-2][1]) \
                    - (r[-1][1] - r[-2][1]) * (p[0] - r[-2][0]) <= 0:
                r.pop()
            r.append(p)
        return r

    return half(pts)[:-1] + half(pts[::-1])[:-1]


def area(q):
    return abs(sum(q[i][0] * q[(i + 1) % len(q)][1] - q[(i + 1) % len(q)][0] * q[i][1]
                   for i in range(len(q)))) / 2


def largest_quad(v):
    """4 hull vertices maximising enclosed area (the true corners). Hull is
    small (<~30 verts) so brute force over C(n,4) is cheap."""
    return v if len(v) <= 4 else list(max(itertools.combinations(v, 4), key=area))


def order(q):
    """TL,TR,BR,BL clockwise, starting at the min-(x+y) corner."""
    cx = sum(p[0] for p in q) / 4
    cy = sum(p[1] for p in q) / 4
    c = sorted(q, key=lambda p: math.atan2(p[1] - cy, p[0] - cx))
    st = min(range(4), key=lambda i: c[i][0] + c[i][1])
    o = c[st:] + c[:st]
    a = sum(o[i][0] * o[(i + 1) % 4][1] - o[(i + 1) % 4][0] * o[i][1] for i in range(4))
    return [o[0], o[3], o[2], o[1]] if a < 0 else o


def main():
    root = os.path.join(os.path.dirname(__file__), "..", "train-dataset")
    out, skipped = [], []
    for png in sorted(glob.glob(os.path.join(root, "*.mask.png"))):
        m, w, h = read_mask(png)
        ys, xs = np.where(m)
        if len(xs) < 100:
            skipped.append(os.path.basename(png))
            continue
        hv = hull(np.column_stack([xs, ys]).astype(float).tolist())
        if len(hv) < 4:
            skipped.append(os.path.basename(png))
            continue
        q = order(largest_quad(hv))
        out.append({
            "id": os.path.basename(png)[:-9],  # strip ".mask.png"
            "w": w, "h": h,
            "coverage": round(area(q) / (w * h), 3),
            "corners": [[round(x, 1), round(y, 1)] for x, y in q],
        })
    json.dump(out, open(os.path.join(root, "labels.json"), "w"), indent=1)
    print(f"wrote {len(out)} labels; skipped {skipped}")


if __name__ == "__main__":
    main()
