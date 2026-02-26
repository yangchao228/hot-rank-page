const api = require("../../utils/api");
const { getBaseUrl } = require("../../utils/storage");
const { formatIsoToMMDDHHmm } = require("../../utils/time");

Page({
  data: {
    baseUrl: "",
    sources: [],
    sourceTitleMap: {},
    selectedSourceIds: [],
    showSourcePanel: false,

    limitOptions: [20, 30, 50, 80, 100],
    limitIndex: 2,

    items: [],
    total: 0,
    updateTime: "",
    failedSources: [],

    loading: false,
    error: ""
  },

  formatTime(iso) {
    return formatIsoToMMDDHHmm(iso);
  },

  onShow() {
    // 从设置页返回时刷新 baseUrl 展示
    this.setData({ baseUrl: getBaseUrl() });
  },

  async onLoad() {
    this.setData({ baseUrl: getBaseUrl() });
    await this.init();
  },

  async onPullDownRefresh() {
    await this.refresh();
    wx.stopPullDownRefresh();
  },

  async init() {
    try {
      this.setData({ loading: true, error: "" });
      const sources = await api.getSources();
      const sourceTitleMap = {};
      for (const s of sources) {
        sourceTitleMap[s.id] = s.title;
      }

      this.setData({
        sources,
        sourceTitleMap,
        selectedSourceIds: sources.map((s) => s.id)
      });

      await this.refresh();
    } catch (e) {
      this.setData({ error: e && e.message ? e.message : "初始化失败" });
    } finally {
      this.setData({ loading: false });
    }
  },

  toggleSourcePanel() {
    this.setData({ showSourcePanel: !this.data.showSourcePanel });
  },

  onSourceChange(e) {
    const values = (e && e.detail && e.detail.value) || [];
    this.setData({ selectedSourceIds: values });
  },

  selectAll() {
    this.setData({ selectedSourceIds: this.data.sources.map((s) => s.id) });
  },

  clearAll() {
    this.setData({ selectedSourceIds: [] });
  },

  async applySources() {
    this.setData({ showSourcePanel: false });
    await this.refresh();
  },

  async onLimitChange(e) {
    const idx = Number((e && e.detail && e.detail.value) || 0);
    this.setData({ limitIndex: idx });
    await this.refresh();
  },

  async refresh() {
    try {
      this.setData({ loading: true, error: "" });
      const limit = this.data.limitOptions[this.data.limitIndex];
      const sources = this.data.selectedSourceIds;

      const data = await api.getAggregate({ sources, limit });
      this.setData({
        items: data.items || [],
        total: data.total || 0,
        updateTime: data.updateTime || "",
        failedSources: data.failedSources || []
      });
    } catch (e) {
      this.setData({ error: e && e.message ? e.message : "刷新失败" });
    } finally {
      this.setData({ loading: false });
    }
  },

  onItemTap(e) {
    const idx = Number(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.index);
    const item = this.data.items[idx];
    if (!item) return;

    const link = item.mobileUrl || item.url || "";
    const actions = [];
    if (link) actions.push("复制链接");
    actions.push("复制标题");

    wx.showActionSheet({
      itemList: actions,
      success: (res) => {
        const tapIndex = res.tapIndex;
        const picked = actions[tapIndex];
        if (picked === "复制链接") {
          wx.setClipboardData({
            data: link,
            success: () => wx.showToast({ title: "已复制链接", icon: "success" })
          });
          return;
        }
        wx.setClipboardData({
          data: item.title || "",
          success: () => wx.showToast({ title: "已复制标题", icon: "success" })
        });
      }
    });
  }
});
