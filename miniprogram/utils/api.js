const { getBaseUrl } = require("./storage");

function request(path, query) {
  const baseUrl = getBaseUrl();
  const url = baseUrl + path;

  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: "GET",
      data: query || {},
      header: {
        "content-type": "application/json"
      },
      success(res) {
        if (!res || typeof res.statusCode !== "number") {
          reject(new Error("请求失败"));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const msg = (res.data && res.data.message) || `HTTP ${res.statusCode}`;
          reject(new Error(msg));
          return;
        }
        resolve(res.data);
      },
      fail(err) {
        reject(err || new Error("网络错误"));
      }
    });
  });
}

async function getSources() {
  const res = await request("/api/v1/sources");
  if (!res || res.code !== 200) {
    throw new Error((res && res.message) || "获取源列表失败");
  }
  return res.data || [];
}

async function getAggregate(options) {
  const query = {};
  if (options && Array.isArray(options.sources) && options.sources.length > 0) {
    query.sources = options.sources.join(",");
  }
  if (options && options.limit) {
    query.limit = options.limit;
  }
  const res = await request("/api/v1/hot/aggregate", query);
  if (!res || res.code !== 200) {
    throw new Error((res && res.message) || "获取聚合热榜失败");
  }
  return res.data;
}

module.exports = {
  getSources,
  getAggregate
};
