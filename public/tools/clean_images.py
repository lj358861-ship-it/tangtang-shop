"""Clean + upscale product photos. Usage: clean_images.py <src_dir> <out_dir> <prefix> [maxside]"""
import cv2, numpy as np, sys, glob, os
src, out, prefix = sys.argv[1:4]
MAX = int(sys.argv[4]) if len(sys.argv) > 4 else 900
os.makedirs(out, exist_ok=True)

def autotrim(im):
    h, w = im.shape[:2]
    b = np.concatenate([im[0], im[-1], im[:, 0], im[:, -1]]).reshape(-1, 3)
    bg = np.median(b, axis=0)
    # only trim if border is quite uniform (padding), otherwise keep the picture intact
    if np.mean(np.abs(b - bg).max(axis=1) < 18) < 0.85:
        return im
    diff = np.abs(im.astype(int) - bg).max(axis=2) > 22
    ys, xs = np.where(diff)
    if len(ys) < 50: return im
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    if (y1 - y0) * (x1 - x0) < 0.25 * h * w: return im
    m = int(0.03 * max(y1 - y0, x1 - x0))
    return im[max(0, y0 - m):min(h, y1 + m + 1), max(0, x0 - m):min(w, x1 + m + 1)]

def clean(im):
    im = autotrim(im)
    h, w = im.shape[:2]
    # light denoise (removes JPEG blocking before enlarging)
    im = cv2.fastNlMeansDenoisingColored(im, None, 3, 3, 5, 15)
    scale = MAX / max(h, w)
    if scale > 1.0:
        im = cv2.resize(im, None, fx=scale, fy=scale, interpolation=cv2.INTER_LANCZOS4)
    elif scale < 1.0:
        im = cv2.resize(im, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    # gentle contrast on luminance + unsharp mask
    lab = cv2.cvtColor(im, cv2.COLOR_BGR2LAB)
    l = cv2.createCLAHE(clipLimit=1.4, tileGridSize=(8, 8)).apply(lab[:, :, 0])
    im = cv2.cvtColor(cv2.merge([l, lab[:, :, 1], lab[:, :, 2]]), cv2.COLOR_LAB2BGR)
    blur = cv2.GaussianBlur(im, (0, 0), 1.6)
    im = cv2.addWeighted(im, 1.55, blur, -0.55, 0)
    # push a near-white studio background to pure white
    bgm = np.median(np.concatenate([im[0], im[-1], im[:, 0], im[:, -1]]).reshape(-1, 3), axis=0)
    if bgm.min() > 215:
        im = np.clip(im.astype(np.float32) * (255.0 / bgm.astype(np.float32)), 0, 255).astype(np.uint8)
    return im

def work(f):
    im = cv2.imread(f)
    if im is None: return
    o = clean(im)
    name = f"{prefix}{os.path.splitext(os.path.basename(f))[0].split('-')[-1]}.jpg"
    cv2.imwrite(os.path.join(out, name), o, [cv2.IMWRITE_JPEG_QUALITY, 84, cv2.IMWRITE_JPEG_PROGRESSIVE, 1])

if __name__ == '__main__':
    from multiprocessing import Pool
    cv2.setNumThreads(1)
    files = sorted(glob.glob(os.path.join(src, '*.jpg')))
    with Pool(os.cpu_count()) as p: p.map(work, files, chunksize=4)
    print(len(files), 'done')
