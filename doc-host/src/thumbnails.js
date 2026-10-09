'use strict';

const JPEG_QUALITY = 80;

// A picture of what the web contents shows now: 'data:image/jpeg;base64,…',
// width device pixels wide, or null when the capture fails, comes back empty
// or the web contents is gone. Never throws. stayHidden: a view hidden with
// setVisible(false) still captures (once it has been shown).
async function captureThumbnail(webContents, { width }) {
  try {
    if (webContents.isDestroyed()) return null;
    const image = await webContents.capturePage(undefined, { stayHidden: true });
    if (!image || image.isEmpty()) return null;
    const size = image.getSize();
    const target = Math.max(1, Math.round(width));
    const resized = size.width > target ? image.resize({ width: target, quality: 'best' }) : image;
    const jpeg = resized.toJPEG(JPEG_QUALITY);
    if (!jpeg || jpeg.length === 0) return null;
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  } catch {
    return null;
  }
}

module.exports = { captureThumbnail };
