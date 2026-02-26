const { getBaseUrl, setBaseUrl, normalizeBaseUrl } = require("../../utils/storage");

Page({
  data: {
    baseUrl: ""
  },

  onLoad() {
    this.setData({ baseUrl: getBaseUrl() });
  },

  onInput(e) {
    const v = (e && e.detail && e.detail.value) || "";
    this.setData({ baseUrl: v });
  },

  save() {
    const normalized = normalizeBaseUrl(this.data.baseUrl);
    if (!normalized) {
      wx.showToast({ title: "请输入有效地址", icon: "none" });
      return;
    }
    setBaseUrl(normalized);
    wx.showToast({ title: "已保存", icon: "success" });
    setTimeout(() => {
      wx.navigateBack();
    }, 400);
  }
});
