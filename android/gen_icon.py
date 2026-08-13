#!/usr/bin/env python3
# 生成现代扁平启动图标：靛蓝圆角方底 + 白色棋子剪影。
# 纯标准库实现（无 PIL），超采样抗锯齿。
import zlib, struct, math, sys

OUT = sys.argv[1] if len(sys.argv) > 1 else "ic_launcher.png"
SIZE = 432          # 输出边长
SS = 4              # 超采样倍数
W = SIZE * SS
feather = W * 0.0045
N = W * W

def tanh(x):
    if x > 8: return 1.0
    if x < -8: return -1.0
    e = math.exp(2 * x)
    return (e - 1) / (e + 1)

def sd_box(px, py, hx, hy, r):
    qx = abs(px) - hx + r
    qy = abs(py) - hy + r
    ox = max(qx, 0); oy = max(qy, 0)
    out = math.hypot(ox, oy)
    ins = min(max(qx, qy), 0)
    return out + ins - r

def sd_circle(px, py, cx, cy, r):
    return math.hypot(px - cx, py - cy) - r

def sd_convex(px, py, pts):
    d = -1e18
    n = len(pts)
    for i in range(n):
        ax, ay = pts[i]; bx, by = pts[(i + 1) % n]
        ex = bx - ax; ey = by - ay
        wx = px - ax; wy = py - ay
        L = ex * ex + ey * ey
        t = 0.0 if L == 0 else max(0.0, min(1.0, (wx * ex + wy * ey) / L))
        cx = ax + ex * t; cy = ay + ey * t
        dist = math.hypot(px - cx, py - cy)
        cross = ex * (py - ay) - ey * (px - ax)
        s = -1.0 if cross >= 0 else 1.0
        d = max(d, dist * s)
    return d

def alpha(sd):
    return 0.5 - 0.5 * tanh(sd / feather)

cx = W / 2.0
# 棋子各部件
head = ('circle', cx, W * 0.31, W * 0.13)
collar = ('poly', [(cx - W*0.05, W*0.43), (cx + W*0.05, W*0.43),
                   (cx + W*0.075, W*0.49), (cx - W*0.075, W*0.49)])
body = ('poly', [(cx - W*0.075, W*0.49), (cx + W*0.075, W*0.49),
                 (cx + W*0.17, W*0.79), (cx - W*0.17, W*0.79)])
base = ('box', cx, W*0.82, W*0.185, W*0.045, W*0.025)

def pawn_sd(px, py):
    sd = 1e18
    for part in (head, collar, body, base):
        if part[0] == 'circle':
            sd = min(sd, sd_circle(px, py, part[1], part[2], part[3]))
        elif part[0] == 'poly':
            sd = min(sd, sd_convex(px, py, part[1]))
        elif part[0] == 'box':
            sd = min(sd, sd_box(px - part[1], py - part[2], part[3], part[4], part[5]))
    return sd

# 背景：圆角方
bg_r = W * 0.16

# 超采样渲染
R = [0.0] * N
G = [0.0] * N
B = [0.0] * N
A = [0.0] * N
for y in range(W):
    row = y * W
    for x in range(W):
        sd_bg = sd_box(x - cx, y - W/2, W/2, W/2, bg_r)
        a_bg = alpha(sd_bg)
        # 背景渐变（上 #4f46e5 -> 下 #4338ca）
        t = y / W
        br = (75 + (67 - 75) * t) / 255
        bg_ = (70 + (56 - 70) * t) / 255
        bb = (229 + (202 - 229) * t) / 255
        # 棋子（白）
        a_p = alpha(pawn_sd(x, y))
        # 合成：棋子盖在背景上
        a = max(a_bg, a_p)
        r = br * a_bg * (1 - a_p) + a_p
        g = bg_ * a_bg * (1 - a_p) + a_p
        b = bb * a_bg * (1 - a_p) + a_p
        i = row + x
        R[i] = max(0.0, min(1.0, r))
        G[i] = max(0.0, min(1.0, g))
        B[i] = max(0.0, min(1.0, b))
        A[i] = max(0.0, min(1.0, a))

# 盒式下采样
def avg(ch, ox, oy):
    s = 0.0
    for j in range(SS):
        row = (oy + j) * W
        for i in range(SS):
            s += ch[row + ox + i]
    return s / (SS * SS)

raw = bytearray()
for y in range(SIZE):
    raw.append(0)  # filter byte per PNG row
    oy = y * SS
    for x in range(SIZE):
        ox = x * SS
        raw.append(int(avg(R, ox, oy) * 255))
        raw.append(int(avg(G, ox, oy) * 255))
        raw.append(int(avg(B, ox, oy) * 255))
        raw.append(int(avg(A, ox, oy) * 255))

def chunk(t, d):
    c = t + d
    return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

png = (b'\x89PNG\r\n\x1a\n'
       + chunk(b'IHDR', struct.pack('>IIBBBBB', SIZE, SIZE, 8, 6, 0, 0, 0))
       + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
       + chunk(b'IEND', b''))
with open(OUT, 'wb') as f:
    f.write(png)
print("icon written:", OUT, SIZE, "px")
