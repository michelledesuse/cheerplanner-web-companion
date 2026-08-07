"""Remove the white background from the CheerPlanner logo using an edge-connected
flood fill so that only the outer white area becomes transparent (any white inside
the artwork is preserved). Feathers the alpha slightly to avoid a hard halo."""
from collections import deque
from PIL import Image

SRC = "/app/frontend/assets/images/cheerplanner-logo.png"
THRESH = 238  # pixels with all channels >= this are considered "white background"

im = Image.open(SRC).convert("RGBA")
w, h = im.size
px = im.load()

def is_white(x, y):
    r, g, b, a = px[x, y]
    return r >= THRESH and g >= THRESH and b >= THRESH

visited = bytearray(w * h)
q = deque()

# Seed the flood fill from every border pixel that is white.
for x in range(w):
    for y in (0, h - 1):
        if is_white(x, y) and not visited[y * w + x]:
            visited[y * w + x] = 1
            q.append((x, y))
for y in range(h):
    for x in (0, w - 1):
        if is_white(x, y) and not visited[y * w + x]:
            visited[y * w + x] = 1
            q.append((x, y))

while q:
    x, y = q.popleft()
    r, g, b, _ = px[x, y]
    px[x, y] = (r, g, b, 0)  # make transparent
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx, ny = x + dx, y + dy
        if 0 <= nx < w and 0 <= ny < h and not visited[ny * w + nx] and is_white(nx, ny):
            visited[ny * w + nx] = 1
            q.append((nx, ny))

im.save(SRC)
print("Saved transparent logo:", SRC, im.size, im.mode)
