'use strict';

const METRICS = { tabStrip: 32, banner: 36, moreBanners: 24, divider: 4 };
const MAX_SHOWN_BANNERS = 3;

function bannerRowHeight(count) {
  if (!(count > 0)) return 0;
  return Math.min(count, MAX_SHOWN_BANNERS) * METRICS.banner + (count > MAX_SHOWN_BANNERS ? METRICS.moreBanners : 0);
}

function paneLayout(paneId, rect, bannerHeight) {
  const tabStripHeight = Math.min(METRICS.tabStrip, rect.height);
  const rest = rect.height - tabStripHeight;
  const bannersHeight = Math.max(0, Math.min(Math.floor(bannerHeight(paneId)) || 0, rest));
  const documentY = rect.y + tabStripHeight + bannersHeight;
  return {
    paneId,
    tabStrip: { x: rect.x, y: rect.y, width: rect.width, height: tabStripHeight },
    banners: { x: rect.x, y: rect.y + tabStripHeight, width: rect.width, height: bannersHeight },
    document: { x: rect.x, y: documentY, width: rect.width, height: rest - bannersHeight },
  };
}

function place(node, rect, bannerHeight, out) {
  if (node.kind === 'pane') {
    out.panes.push(paneLayout(node.id, rect, bannerHeight));
    return;
  }
  const row = node.direction === 'row';
  const total = row ? rect.width : rect.height;
  const available = Math.max(0, total - (node.children.length - 1) * METRICS.divider);
  let offset = 0;
  let used = 0;
  node.children.forEach((child, index) => {
    const last = index === node.children.length - 1;
    const extent = last ? available - used : Math.floor(available * node.sizes[index]);
    used += extent;
    const childRect = row
      ? { x: rect.x + offset, y: rect.y, width: extent, height: rect.height }
      : { x: rect.x, y: rect.y + offset, width: rect.width, height: extent };
    place(child, childRect, bannerHeight, out);
    offset += extent;
    if (!last) {
      out.dividers.push({
        splitId: node.id,
        index,
        direction: node.direction,
        rect: row
          ? { x: rect.x + offset, y: rect.y, width: METRICS.divider, height: rect.height }
          : { x: rect.x, y: rect.y + offset, width: rect.width, height: METRICS.divider },
      });
      offset += METRICS.divider;
    }
  });
}

function computeLayout(model, { width, height }, { bannerHeight = () => 0 } = {}) {
  const listWidth = model.list.visible ? Math.min(model.list.width, width) : 0;
  const list = model.list.visible ? { x: 0, y: 0, width: listWidth, height } : null;
  const out = { list, panes: [], dividers: [] };
  place(model.root, { x: listWidth, y: 0, width: width - listWidth, height }, bannerHeight, out);
  return out;
}

function wholeRect(p) {
  return {
    x: p.tabStrip.x,
    y: p.tabStrip.y,
    width: p.tabStrip.width,
    height: p.tabStrip.height + p.banners.height + p.document.height,
  };
}

function overlapOf(aStart, aLength, bStart, bLength) {
  return Math.min(aStart + aLength, bStart + bLength) - Math.max(aStart, bStart);
}

function neighbourPane(layout, paneId, direction) {
  const origin = layout.panes.find((p) => p.paneId === paneId);
  if (!origin) return null;
  const a = wholeRect(origin);
  let best = null;
  for (const candidate of layout.panes) {
    if (candidate.paneId === paneId) continue;
    const b = wholeRect(candidate);
    let gap;
    let overlap;
    if (direction === 'right') {
      if (b.x < a.x + a.width) continue;
      gap = b.x - (a.x + a.width);
      overlap = overlapOf(a.y, a.height, b.y, b.height);
    } else if (direction === 'left') {
      if (b.x + b.width > a.x) continue;
      gap = a.x - (b.x + b.width);
      overlap = overlapOf(a.y, a.height, b.y, b.height);
    } else if (direction === 'down') {
      if (b.y < a.y + a.height) continue;
      gap = b.y - (a.y + a.height);
      overlap = overlapOf(a.x, a.width, b.x, b.width);
    } else if (direction === 'up') {
      if (b.y + b.height > a.y) continue;
      gap = a.y - (b.y + b.height);
      overlap = overlapOf(a.x, a.width, b.x, b.width);
    } else {
      return null;
    }
    if (overlap <= 0) continue;
    if (!best || gap < best.gap || (gap === best.gap && overlap > best.overlap)) {
      best = { id: candidate.paneId, gap, overlap };
    }
  }
  return best ? best.id : null;
}

module.exports = { METRICS, bannerRowHeight, computeLayout, neighbourPane };
