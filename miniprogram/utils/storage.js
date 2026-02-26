const KEY_BASE_URL = "HOT_RANK_BASE_URL";

function normalizeBaseUrl(url) {
  if (!url || typeof url !== "string") return "";
  const trimmed = url.trim();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function getBaseUrl() {
  const saved = wx.getStorageSync(KEY_BASE_URL);
  const normalized = normalizeBaseUrl(saved);
  if (normalized) return normalized;
  return "http://212.129.238.55";
}

function setBaseUrl(url) {
  const normalized = normalizeBaseUrl(url);
  if (!normalized) {
    wx.removeStorageSync(KEY_BASE_URL);
    return;
  }
  wx.setStorageSync(KEY_BASE_URL, normalized);
}

module.exports = {
  getBaseUrl,
  setBaseUrl,
  normalizeBaseUrl
};
